import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { bumpRevision, getDb } from "./db";
import { cleanMailHtml } from "./html";
import { holdDb, persistDb } from "./snapshot";
import { loadAccount, withImap, type MailAccount } from "./connection";
import { findThread, newThreadId, normalizeMessageId, recomputeAccount } from "./threads";
import { triageAccount } from "./triage";

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function mailBody(parsed: ParsedMail) {
  const html = typeof parsed.html === "string" ? cleanMailHtml(parsed.html) : "";
  const text = (parsed.text || "")
    .replaceAll("\u0000", "")
    .slice(0, 100_000);
  if (text.trim() || !html) return { text, html };
  const plain = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
  return { text: plain, html };
}

function roleOf(box: { path: string; name: string; specialUse?: string }) {
  const use = box.specialUse ?? "";
  const name = box.name.toLowerCase();
  if (use === "\\Inbox" || box.path.toUpperCase() === "INBOX") return "inbox";
  if (use === "\\Sent" || name === "sent" || name === "sent items" || name === "sent messages") return "sent";
  if (use === "\\Archive" || name === "archive" || name === "archives") return "archive";
  if (use === "\\Trash" || ["trash", "deleted", "deleted items", "deleted messages", "bin"].includes(name)) {
    return "trash";
  }
  return "other";
}

export async function refreshMailboxes(client: ImapFlow, accountId: string) {
  const boxes = await client.list();
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO mailboxes (account_id, path, role, uid_validity) VALUES (?, ?, ?, NULL)
     ON CONFLICT(account_id, path) DO UPDATE SET role = excluded.role`,
  );
  let hasInbox = false;
  let hasArchive = false;
  let hasTrash = false;
  for (const box of boxes) {
    const role = roleOf(box);
    if (role === "inbox") hasInbox = true;
    if (role === "archive") hasArchive = true;
    if (role === "trash") hasTrash = true;
    upsert.run(accountId, box.path, role);
  }
  if (!hasInbox) upsert.run(accountId, "INBOX", "inbox");
  if (!hasArchive) {
    try {
      await client.mailboxCreate("Archive");
    } catch {
      // Already there under a name list() didn't tag.
    }
    upsert.run(accountId, "Archive", "archive");
  }
  if (!hasTrash) {
    try {
      await client.mailboxCreate("Trash");
      upsert.run(accountId, "Trash", "trash");
    } catch {
      // Some servers name it for us or refuse creation. Archive still works.
    }
  }
}

export function folderPath(accountId: string, role: string): string | null {
  const row = getDb()
    .prepare("SELECT path FROM mailboxes WHERE account_id = ? AND role = ? LIMIT 1")
    .get(accountId, role) as { path: string } | undefined;
  return row?.path ?? null;
}

function asUids(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((n): n is number => typeof n === "number") : [];
}

function hasFlag(flags: Set<string> | undefined, name: string) {
  if (!flags) return false;
  const want = name.toLowerCase();
  for (const flag of flags) if (flag.toLowerCase() === want) return true;
  return false;
}

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((entry) => (entry.value ?? []).map((a) => a.address || "").filter(Boolean));
}

function referenceIds(parsed: ParsedMail): string[] {
  const raw = parsed.references;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((id) => normalizeMessageId(id)).filter(Boolean);
}

async function syncFolder(
  client: ImapFlow,
  account: MailAccount,
  folder: string,
  dirty: Set<string>,
  deletes: { folder: string; uid: number }[],
) {
  const db = getDb();
  const lock = await client.getMailboxLock(folder);
  try {
    const since = new Date(Date.now() - WINDOW_MS);
    let remote: number[] = [];
    try {
      remote = asUids(await client.search({ since }, { uid: true }));
    } catch {
      remote = asUids(await client.search({ all: true }, { uid: true }));
    }
    const knownRows = db
      .prepare("SELECT uid FROM messages WHERE account_id = ? AND folder = ?")
      .all(account.id, folder) as { uid: number }[];
    const known = new Set(knownRows.map((r) => r.uid));
    const remoteSet = new Set(remote);
    const fresh = remote.filter((uid) => !known.has(uid)).slice(-300);

    if (fresh.length > 0) {
      const fetched = await client.fetchAll(
        fresh,
        { uid: true, flags: true, source: true, internalDate: true },
        { uid: true },
      );
      for (const msg of fetched) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const messageId = normalizeMessageId(parsed.messageId) || `uid-${folder}-${msg.uid}`;
        const inReplyTo = normalizeMessageId(parsed.inReplyTo);
        const prior = (
          messageId
            ? db
                .prepare(
                  "SELECT id, thread_id FROM messages WHERE account_id = ? AND message_id = ?",
                )
                .get(account.id, messageId)
            : undefined
        ) as { id: string; thread_id: string } | undefined;
        const threadId =
          prior?.thread_id ??
          findThread(account.id, inReplyTo, referenceIds(parsed)) ??
          newThreadId(messageId);
        if (prior) db.prepare("DELETE FROM messages WHERE id = ?").run(prior.id);
        const from = parsed.from?.value?.[0];
        const internal = msg.internalDate instanceof Date ? msg.internalDate.getTime() : Date.now();
        const auto = String(parsed.headers.get("auto-submitted") ?? "").toLowerCase();
        const listHeader = parsed.headers.get("list");
        const listObjects = Array.isArray(listHeader) ? listHeader : listHeader ? [listHeader] : [];
        const listUnsub =
          listObjects.some((entry) => entry && typeof entry === "object" && "unsubscribe" in entry) ||
          parsed.headerLines.some((line) => line.key.toLowerCase() === "list-unsubscribe");
        const stored = mailBody(parsed);
        db.prepare(
          `INSERT INTO messages (
             id, account_id, thread_id, folder, uid, message_id, in_reply_to, from_name, from_email,
             to_json, subject, sent_at, body, html, seen, flagged, list_unsub, auto_submitted
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          prior?.id ?? randomUUID(),
          account.id,
          threadId,
          folder,
          msg.uid,
          messageId,
          inReplyTo,
          from?.name || from?.address || "Unknown",
          (from?.address || "unknown@unknown").toLowerCase(),
          JSON.stringify(addressList(parsed.to)),
          parsed.subject || "(no subject)",
          parsed.date?.getTime() || internal,
          stored.text,
          stored.html,
          hasFlag(msg.flags, "\\Seen") ? 1 : 0,
          hasFlag(msg.flags, "\\Flagged") ? 1 : 0,
          listUnsub ? 1 : 0,
          auto && auto !== "no" ? 1 : 0,
        );
        dirty.add(threadId);
      }
    }

    const existing = remote.filter((uid) => known.has(uid));
    if (existing.length > 0) {
      const flagged = await client.fetchAll(existing, { uid: true, flags: true }, { uid: true });
      const update = db.prepare(
        "UPDATE messages SET seen = ?, flagged = ? WHERE account_id = ? AND folder = ? AND uid = ?",
      );
      for (const msg of flagged) {
        update.run(
          hasFlag(msg.flags, "\\Seen") ? 1 : 0,
          hasFlag(msg.flags, "\\Flagged") ? 1 : 0,
          account.id,
          folder,
          msg.uid,
        );
      }
    }

    const pending = (
      db
        .prepare(
          "SELECT uid FROM messages WHERE account_id = ? AND folder = ? AND html IS NULL LIMIT 40",
        )
        .all(account.id, folder) as { uid: number }[]
    )
      .map((row) => row.uid)
      .filter((uid) => remoteSet.has(uid));
    if (pending.length > 0) {
      const older = await client.fetchAll(pending, { uid: true, source: true }, { uid: true });
      const fill = db.prepare(
        "UPDATE messages SET html = ?, body = CASE WHEN body = '' THEN ? ELSE body END WHERE account_id = ? AND folder = ? AND uid = ?",
      );
      for (const msg of older) {
        if (!msg.source) continue;
        const stored = mailBody(await simpleParser(msg.source));
        fill.run(stored.html, stored.text, account.id, folder, msg.uid);
      }
    }

    for (const uid of known) {
      if (!remoteSet.has(uid)) deletes.push({ folder, uid });
    }
  } finally {
    lock.release();
  }
}

export function accountIds() {
  return (getDb().prepare("SELECT id FROM accounts").all() as { id: string }[]).map((r) => r.id);
}

export async function syncAccount(id: string) {
  return holdDb(() => syncAccountHeld(id));
}

async function syncAccountHeld(id: string) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "UPDATE accounts SET syncing = 0 WHERE syncing = 1 AND IFNULL(syncing_since, 0) < ?",
  ).run(now - 10 * 60 * 1000);
  const claimed = db
    .prepare("UPDATE accounts SET syncing = 1, syncing_since = ? WHERE id = ? AND syncing = 0")
    .run(now, id);
  if (claimed.changes === 0) return;

  try {
    const account = loadAccount(id);
    const dirty = new Set<string>();
    const deletes: { folder: string; uid: number }[] = [];
    await withImap(account, async (client) => {
      await refreshMailboxes(client, id);
      const folders = db
        .prepare(
          "SELECT path FROM mailboxes WHERE account_id = ? AND role IN ('inbox', 'sent', 'archive', 'trash')",
        )
        .all(id) as { path: string }[];
      for (const folder of folders) {
        await syncFolder(client, account, folder.path, dirty, deletes);
      }
    });

    const select = db.prepare(
      "SELECT thread_id FROM messages WHERE account_id = ? AND folder = ? AND uid = ?",
    );
    const remove = db.prepare("DELETE FROM messages WHERE account_id = ? AND folder = ? AND uid = ?");
    for (const gone of deletes) {
      const row = select.get(id, gone.folder, gone.uid) as { thread_id: string } | undefined;
      if (!row) continue;
      dirty.add(row.thread_id);
      remove.run(id, gone.folder, gone.uid);
    }

    recomputeAccount(id, dirty);
    await triageAccount(id);
    db.prepare("UPDATE accounts SET last_sync_at = ?, sync_error = NULL WHERE id = ?").run(Date.now(), id);
    bumpRevision();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    db.prepare("UPDATE accounts SET sync_error = ? WHERE id = ?").run(message.slice(0, 500), id);
    throw err;
  } finally {
    db.prepare("UPDATE accounts SET syncing = 0 WHERE id = ?").run(id);
    try {
      await persistDb();
    } catch (err) {
      console.error("[snapshot]", err instanceof Error ? err.message : err);
    }
  }
}
