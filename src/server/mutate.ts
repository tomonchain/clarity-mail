import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SPACE_COLORS } from "@/lib/seed";
import { PROVIDER_PRESETS } from "@/lib/providers";
import type { RuleField } from "@/lib/types";
import {
  isActionError,
  purgeThread,
  sendNew,
  sendReply,
  setThreadStar,
  setThreadStatus,
  setThreadUnread,
} from "./actions";
import { encryptSecret } from "./crypto";
import { mailAccount, testLogin } from "./connection";
import { bumpRevision, dropOrphanImages, getDb, type AccountRow } from "./db";
import { detectSettings } from "./detect";
import { isNetworkError } from "./network";
import { syncAccount } from "./sync";
import { recomputeAccount } from "./threads";

/** Sync soon after sending so the sent mail shows up in its thread. */
function syncSoon(accountId: string) {
  void syncAccount(accountId).catch((err) => console.error("[sync]", err instanceof Error ? err.message : err));
}

/** "a@x.fr, Bob <b@y.com>; c@z.io" -> ["a@x.fr", "b@y.com", "c@z.io"] */
export function parseAddresses(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const address = (trimmed.match(/<([^>]+)>/)?.[1] ?? trimmed).trim();
    if (!z.string().email().safeParse(address).success) throw new ApiError(`"${trimmed}" is not an email address.`);
    out.push(address);
  }
  return out;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(result.error.issues[0]?.message ?? "Invalid request.");
  }
  return result.data;
}

function failAction(err: unknown): never {
  if (isActionError(err)) throw new ApiError(err.message, 502);
  // Offline, or the mail server is down: say so instead of "Something went wrong".
  if (isNetworkError(err)) {
    throw new ApiError("Can't reach the mail server. Check your connection and try again.", 502);
  }
  throw err;
}

const connectionSchema = z.object({
  provider: z.enum(["icloud", "gmail", "ovh-mxplan", "imap"]),
  email: z.string().trim().email(),
  username: z.string().trim().optional(),
  password: z.string().min(1),
  imapHost: z.string().trim().optional(),
  imapPort: z.number().int().positive().max(65535).optional(),
  imapSecure: z.boolean().optional(),
  smtpHost: z.string().trim().optional(),
  smtpPort: z.number().int().positive().max(65535).optional(),
  smtpSecure: z.boolean().optional(),
});

type ConnectionInput = z.infer<typeof connectionSchema>;

function resolveConnection(input: ConnectionInput) {
  const preset = PROVIDER_PRESETS[input.provider];
  const imapHost = input.imapHost || preset.imapHost;
  const smtpHost = input.smtpHost || preset.smtpHost;
  if (!imapHost || !smtpHost) throw new ApiError("IMAP and SMTP hosts are required.");
  return {
    email: input.email.toLowerCase(),
    username: (input.username || input.email).toLowerCase(),
    password: input.password,
    imapHost,
    imapPort: input.imapPort ?? preset.imapPort,
    imapSecure: input.imapSecure ?? preset.imapSecure,
    smtpHost,
    smtpPort: input.smtpPort ?? preset.smtpPort,
    smtpSecure: input.smtpSecure ?? preset.smtpSecure,
  };
}

async function checkConnection(input: ConnectionInput) {
  const conn = resolveConnection(input);
  try {
    await testLogin(conn);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not connect.";
    throw new ApiError(`Could not sign in to the mailbox. ${message}`, 502);
  }
  return conn;
}

function saved<T>(value: T): T {
  bumpRevision();
  return value;
}

export async function mutate(body: unknown): Promise<unknown> {
  const op = typeof body === "object" && body && "op" in body ? String((body as { op: unknown }).op) : "";
  const db = getDb();

  try {
    switch (op) {
      case "account.test": {
        await checkConnection(parse(connectionSchema, body));
        return { ok: true };
      }
      case "account.create": {
        const input = parse(
          connectionSchema.extend({
            label: z.string().trim().min(1).max(80),
            defaultSpace: z.string().min(1),
            aliases: z.array(z.string().trim().email()).max(20).optional(),
          }),
          body,
        );
        const space = db.prepare("SELECT id FROM spaces WHERE id = ?").get(input.defaultSpace);
        if (!space) throw new ApiError("Pick a space for this account.");
        const existing = db.prepare("SELECT id FROM accounts WHERE email = ?").get(input.email.toLowerCase());
        if (existing) throw new ApiError("That mailbox is already connected.");
        const conn = await checkConnection(input);
        const id = randomUUID();
        db.prepare(
          `INSERT INTO accounts (
             id, label, email, provider, username, secret, imap_host, imap_port, imap_secure,
             smtp_host, smtp_port, smtp_secure, default_space, aliases
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          input.label,
          conn.email,
          input.provider,
          conn.username,
          encryptSecret(conn.password),
          conn.imapHost,
          conn.imapPort,
          conn.imapSecure ? 1 : 0,
          conn.smtpHost,
          conn.smtpPort,
          conn.smtpSecure ? 1 : 0,
          input.defaultSpace,
          JSON.stringify(input.aliases ?? []),
        );
        void syncAccount(id).catch((err) => console.error("[sync]", err instanceof Error ? err.message : err));
        return saved({ id });
      }
      case "account.delete": {
        const { id } = parse(z.object({ id: z.string() }), body);
        const tx = db.transaction(() => {
          db.prepare("DELETE FROM messages WHERE account_id = ?").run(id);
          db.prepare("DELETE FROM threads WHERE account_id = ?").run(id);
          db.prepare("DELETE FROM mailboxes WHERE account_id = ?").run(id);
          db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
          dropOrphanImages();
        });
        tx();
        return saved({ ok: true });
      }
      case "account.update": {
        const input = parse(
          z.object({
            id: z.string(),
            label: z.string().trim().min(1, "Give the mailbox a name.").max(80).optional(),
            defaultSpace: z.string().min(1).optional(),
            aliases: z.array(z.string().trim().email("Aliases must be email addresses.")).max(20).optional(),
            password: z.string().min(1).optional(),
          }),
          body,
        );
        const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(input.id) as AccountRow | undefined;
        if (!row) throw new ApiError("Mailbox not found.", 404);
        if (input.defaultSpace && !db.prepare("SELECT id FROM spaces WHERE id = ?").get(input.defaultSpace)) {
          throw new ApiError("Pick a space for this mailbox.");
        }
        let secret = row.secret;
        if (input.password) {
          try {
            await testLogin({ ...mailAccount(row), password: input.password });
          } catch (err) {
            const message = err instanceof Error ? err.message : "Could not connect.";
            throw new ApiError(`That password didn't work. ${message}`, 502);
          }
          secret = encryptSecret(input.password);
        }
        const aliases = input.aliases
          ? JSON.stringify([...new Set(input.aliases.map((a) => a.toLowerCase()))])
          : row.aliases;
        db.prepare(
          "UPDATE accounts SET label = ?, default_space = ?, aliases = ?, secret = ? WHERE id = ?",
        ).run(input.label ?? row.label, input.defaultSpace ?? row.default_space, aliases, secret, input.id);
        // "Waiting on others" depends on which addresses are yours.
        if (aliases !== row.aliases) recomputeAccount(input.id);
        if (input.password && row.sync_error) syncSoon(input.id);
        return saved({ ok: true });
      }
      case "account.sync": {
        const { id } = parse(z.object({ id: z.string() }), body);
        try {
          await syncAccount(id);
        } catch (err) {
          throw new ApiError(err instanceof Error ? err.message : "Sync failed", 502);
        }
        return saved({ ok: true });
      }
      case "thread.status": {
        const input = parse(
          z.object({
            id: z.string(),
            status: z.enum(["inbox", "done", "snoozed", "trash", "spam"]),
            snoozedUntil: z.number().optional(),
          }),
          body,
        );
        await setThreadStatus(input.id, input.status, input.snoozedUntil);
        return saved({ ok: true });
      }
      case "thread.read": {
        const { id, unread } = parse(z.object({ id: z.string(), unread: z.boolean() }), body);
        await setThreadUnread(id, unread);
        return saved({ ok: true });
      }
      case "thread.star": {
        const { id, starred } = parse(z.object({ id: z.string(), starred: z.boolean() }), body);
        await setThreadStar(id, starred);
        return saved({ ok: true });
      }
      case "thread.move": {
        const { id, space } = parse(z.object({ id: z.string(), space: z.string() }), body);
        db.prepare("UPDATE threads SET space_override = ? WHERE id = ?").run(space, id);
        return saved({ ok: true });
      }
      case "thread.reply": {
        const input = parse(z.object({ id: z.string(), from: z.string().email(), body: z.string() }), body);
        await sendReply(input.id, input.from, input.body);
        const thread = db.prepare("SELECT account_id FROM threads WHERE id = ?").get(input.id) as
          | { account_id: string }
          | undefined;
        if (thread) syncSoon(thread.account_id);
        return saved({ ok: true });
      }
      case "mail.send": {
        const input = parse(
          z.object({
            from: z.string().trim().email(),
            to: z.string(),
            cc: z.string().optional(),
            subject: z.string().max(500),
            body: z.string().max(200_000),
          }),
          body,
        );
        const accountId = await sendNew({
          from: input.from,
          to: parseAddresses(input.to),
          cc: parseAddresses(input.cc),
          subject: input.subject,
          body: input.body,
        });
        syncSoon(accountId);
        return saved({ ok: true });
      }
      case "account.detect": {
        const { email } = parse(z.object({ email: z.string().trim().email() }), body);
        try {
          return await detectSettings(email);
        } catch (err) {
          throw new ApiError(err instanceof Error ? err.message : "Could not detect the servers.");
        }
      }
      case "thread.bulk": {
        const { ids, action } = parse(
          z.object({
            ids: z.array(z.string()).min(1).max(500),
            action: z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("status"),
                status: z.enum(["inbox", "done", "snoozed", "trash", "spam"]),
                snoozedUntil: z.number().optional(),
              }),
              z.object({ kind: z.literal("read"), unread: z.boolean() }),
              z.object({ kind: z.literal("star"), starred: z.boolean() }),
              z.object({ kind: z.literal("move"), space: z.string() }),
            ]),
          }),
          body,
        );
        if (action.kind === "move") {
          const move = db.prepare("UPDATE threads SET space_override = ? WHERE id = ?");
          db.transaction(() => {
            for (const id of ids) move.run(action.space, id);
          })();
          return saved({ ok: true, failed: 0 });
        }
        const apply = (id: string) => {
          if (action.kind === "status") return setThreadStatus(id, action.status, action.snoozedUntil);
          if (action.kind === "read") return setThreadUnread(id, action.unread);
          return setThreadStar(id, action.starred);
        };
        // Each thread opens its own IMAP connection and mail servers cap them per account,
        // so only a few run at once. One thread failing does not stop the others.
        let failed = 0;
        let lastError: unknown = null;
        const queue = [...ids];
        const worker = async () => {
          for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
            try {
              await apply(id);
            } catch (err) {
              failed += 1;
              lastError = err;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, ids.length) }, worker));
        if (failed === ids.length) failAction(lastError);
        return saved({ ok: true, failed });
      }
      case "thread.clear": {
        const { ids } = parse(z.object({ ids: z.array(z.string()).max(200) }), body);
        for (const id of ids) await setThreadStatus(id, "done");
        return saved({ ok: true });
      }
      case "thread.purge": {
        const { ids } = parse(z.object({ ids: z.array(z.string()).min(1).max(200) }), body);
        for (const id of ids) await purgeThread(id);
        return saved({ ok: true });
      }
      case "thread.restore": {
        const { threads } = parse(
          z.object({
            threads: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.enum(["inbox", "done", "snoozed", "trash", "spam"]),
                  unread: z.boolean(),
                  starred: z.boolean(),
                  snoozedUntil: z.number().optional(),
                }),
              )
              .max(500),
          }),
          body,
        );
        const current = db.prepare("SELECT unread, starred FROM threads WHERE id = ?");
        for (const thread of threads) {
          await setThreadStatus(thread.id, thread.status, thread.snoozedUntil);
          // Undoing a bulk action touches many threads: flags that did not change cost no round trip.
          const now = current.get(thread.id) as { unread: number; starred: number } | undefined;
          if (!now || Boolean(now.unread) !== thread.unread) await setThreadUnread(thread.id, thread.unread);
          if (!now || Boolean(now.starred) !== thread.starred) await setThreadStar(thread.id, thread.starred);
        }
        return saved({ ok: true });
      }
      case "space.add": {
        const { name } = parse(z.object({ name: z.string().trim().min(1).max(40) }), body);
        const count = (db.prepare("SELECT COUNT(*) AS c FROM spaces").get() as { c: number }).c;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "space";
        const id = `${slug}-${Date.now().toString(36)}`;
        db.prepare(
          "INSERT INTO spaces (id, name, description, color, vips, position) VALUES (?, ?, '', ?, '[]', ?)",
        ).run(id, name, SPACE_COLORS[count % SPACE_COLORS.length], count);
        return saved({ id });
      }
      case "space.update": {
        const input = parse(
          z.object({
            id: z.string(),
            name: z.string().trim().min(1).max(40).optional(),
            description: z.string().max(120).optional(),
            color: z.string().optional(),
            vips: z.array(z.string()).optional(),
            slaHours: z.number().int().min(0).nullable().optional(),
            focusHours: z
              .object({ start: z.number(), end: z.number(), weekdaysOnly: z.boolean() })
              .nullable()
              .optional(),
          }),
          body,
        );
        const current = db.prepare("SELECT * FROM spaces WHERE id = ?").get(input.id) as
          | { name: string; description: string; color: string; vips: string; sla_hours: number | null; focus_hours: string | null }
          | undefined;
        if (!current) throw new ApiError("Space not found.");
        db.prepare(
          "UPDATE spaces SET name = ?, description = ?, color = ?, vips = ?, sla_hours = ?, focus_hours = ? WHERE id = ?",
        ).run(
          input.name ?? current.name,
          input.description ?? current.description,
          input.color ?? current.color,
          input.vips ? JSON.stringify(input.vips) : current.vips,
          input.slaHours === undefined ? current.sla_hours : input.slaHours,
          input.focusHours === undefined ? current.focus_hours : input.focusHours ? JSON.stringify(input.focusHours) : null,
          input.id,
        );
        return saved({ ok: true });
      }
      case "space.remove": {
        const { id } = parse(z.object({ id: z.string() }), body);
        const count = (db.prepare("SELECT COUNT(*) AS c FROM spaces").get() as { c: number }).c;
        if (count <= 1) throw new ApiError("Keep at least one space.");
        const fallback = (
          db.prepare("SELECT id FROM spaces WHERE id != ? ORDER BY position LIMIT 1").get(id) as { id: string }
        ).id;
        const tx = db.transaction(() => {
          db.prepare("UPDATE accounts SET default_space = ? WHERE default_space = ?").run(fallback, id);
          db.prepare("UPDATE rules SET space_id = NULL WHERE space_id = ?").run(id);
          db.prepare("DELETE FROM rules WHERE space_id IS NULL AND category IS NULL").run();
          db.prepare("UPDATE threads SET space_override = NULL WHERE space_override = ?").run(id);
          db.prepare("DELETE FROM spaces WHERE id = ?").run(id);
        });
        tx();
        return saved({ ok: true });
      }
      case "rule.add": {
        const input = parse(
          z.object({
            field: z.enum(["to", "fromDomain", "fromEmail", "subject"]),
            value: z.string().trim().min(1).max(200),
            space: z.string().optional(),
            category: z
              .enum(["needs-reply", "fyi", "calendar", "receipt", "notification", "newsletter"])
              .optional(),
          }),
          body,
        );
        if (!input.space && !input.category) throw new ApiError("A rule needs a space or a category.");
        const position = (db.prepare("SELECT COALESCE(MAX(position), -1) AS p FROM rules").get() as { p: number }).p + 1;
        const id = `r-${Date.now().toString(36)}`;
        db.prepare(
          "INSERT INTO rules (id, field, value, space_id, category, position) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(id, input.field satisfies RuleField, input.value, input.space ?? null, input.category ?? null, position);
        return saved({ id });
      }
      case "rule.remove": {
        const { id } = parse(z.object({ id: z.string() }), body);
        db.prepare("DELETE FROM rules WHERE id = ?").run(id);
        return saved({ ok: true });
      }
      default:
        throw new ApiError("Unknown operation.");
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    return failAction(err);
  }
}
