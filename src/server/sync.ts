import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import type { ImapFlow } from "imapflow";
import { randomUUID } from "node:crypto";
import { bumpRevision, dropOrphanImages, getDb, HTML_REV } from "./db";
import { cleanMailHtml } from "./html";
import { holdDb, persistDb } from "./snapshot";
import { loadAccount, withImap, type MailAccount } from "./connection";
import { findThread, newThreadId, normalizeMessageId, recomputeAccount } from "./threads";
import { triageAccount } from "./triage";

const WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

const INLINE_TYPES = new Set(["image/png", "image/gif", "image/jpeg", "image/jpg", "image/pjpeg", "image/webp"]);
const MAX_INLINE_IMAGE = 5 * 1024 * 1024;
const MAX_INLINE_TOTAL = 15 * 1024 * 1024;

type InlineImage = { idx: number; mime: string; data: Buffer };

function normalizeCid(value: string) {
  let cid = value.trim().replace(/^<|>$/g, "");
  try {
    cid = decodeURIComponent(cid);
  } catch {
    // Not percent-encoded.
  }
  return cid.toLowerCase();
}

/**
 * Pictures embedded in the mail (logos, signatures) are referenced as cid:...
 * They are kept apart and served by /api/inline, so the HTML stays small.
 */
function embedImages(parsed: ParsedMail, html: string, messageRowId: string) {
  const byCid = new Map<string, ParsedMail["attachments"][number]>();
  for (const att of parsed.attachments ?? []) {
    if (!att.contentId) continue;
    const mime = (att.contentType || "").toLowerCase();
    if (!INLINE_TYPES.has(mime) || att.size > MAX_INLINE_IMAGE) continue;
    byCid.set(normalizeCid(att.contentId), att);
  }
  const images: InlineImage[] = [];
  if (byCid.size === 0) return { html, images };
  const used = new Map<string, number>();
  let total = 0;
  const out = html.replace(/\bcid:([^'"\s>)]{1,256})/gi, (match, raw: string) => {
    const cid = normalizeCid(raw);
    let idx = used.get(cid);
    if (idx === undefined) {
      const att = byCid.get(cid);
      if (!att || total + att.content.length > MAX_INLINE_TOTAL) return match;
      idx = images.length;
      total += att.content.length;
      const mime = att.contentType.toLowerCase();
      images.push({ idx, mime: mime === "image/jpg" || mime === "image/pjpeg" ? "image/jpeg" : mime, data: att.content });
      used.set(cid, idx);
    }
    return `/api/inline/${messageRowId}/${idx}`;
  });
  return { html: out, images };
}

/** Parse a raw message the way Clarity stores it: cid: links stay links, see embedImages. */
export function parseMail(source: Buffer) {
  return simpleParser(source, { keepCidLinks: true });
}

function mailBody(parsed: ParsedMail, messageRowId: string) {
  const embedded =
    typeof parsed.html === "string" ? embedImages(parsed, parsed.html, messageRowId) : { html: "", images: [] };
  const html = embedded.html ? cleanMailHtml(embedded.html) : "";
  const images = embedded.images.filter((image) => html.includes(`/api/inline/${messageRowId}/${image.idx}"`));
  const text = (parsed.text || "")
    .replaceAll("\u0000", "")
    .slice(0, 100_000);
  if (text.trim() || !html) return { text, html, images };
  const plain = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100_000);
  return { text: plain, html, images };
}

function saveImages(messageRowId: string, images: InlineImage[]) {
  const db = getDb();
  db.prepare("DELETE FROM inline_images WHERE message_id = ?").run(messageRowId);
  const insert = db.prepare("INSERT INTO inline_images (message_id, idx, mime, data) VALUES (?, ?, ?, ?)");
  for (const image of images) insert.run(messageRowId, image.idx, image.mime, image.data);
}

const SENT_NAMES = ["sent", "sent items", "sent messages", "sent mail", "éléments envoyés", "envoyés"];
const TRASH_NAMES = ["trash", "deleted", "deleted items", "deleted messages", "bin", "corbeille", "éléments supprimés"];
const JUNK_NAMES = [
  "junk",
  "spam",
  "junk e-mail",
  "junk email",
  "junk mail",
  "bulk mail",
  "courrier indésirable",
  "indésirables",
  "pourriel",
];

function roleOf(box: { path: string; name: string; specialUse?: string }) {
  const use = box.specialUse ?? "";
  const name = box.name.toLowerCase();
  if (use === "\\Inbox" || box.path.toUpperCase() === "INBOX") return "inbox";
  if (use === "\\Sent" || SENT_NAMES.includes(name)) return "sent";
  if (use === "\\Archive" || name === "archive" || name === "archives") return "archive";
  if (use === "\\Trash" || TRASH_NAMES.includes(name)) return "trash";
  if (use === "\\Junk" || JUNK_NAMES.includes(name)) return "junk";
  return "other";
}

export type FolderRole = "inbox" | "archive" | "trash" | "junk";

const DEFAULT_FOLDER: Record<FolderRole, string> = {
  inbox: "INBOX",
  archive: "Archive",
  trash: "Trash",
  junk: "Junk",
};

/** The path of a role's folder, creating it on the server when the account has none. */
export async function ensureFolder(client: ImapFlow, accountId: string, role: FolderRole) {
  const existing = folderPath(accountId, role);
  if (existing) return existing;
  const path = DEFAULT_FOLDER[role];
  try {
    await client.mailboxCreate(path);
  } catch {
    // Already there under a name list() didn't tag, or the server refuses: try it anyway.
  }
  getDb()
    .prepare(
      `INSERT INTO mailboxes (account_id, path, role, uid_validity) VALUES (?, ?, ?, NULL)
       ON CONFLICT(account_id, path) DO UPDATE SET role = excluded.role`,
    )
    .run(accountId, path, role);
  return path;
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
        const parsed = await parseMail(msg.source);
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
        const rowId = prior?.id ?? randomUUID();
        const stored = mailBody(parsed, rowId);
        db.prepare(
          `INSERT INTO messages (
             id, account_id, thread_id, folder, uid, message_id, in_reply_to, from_name, from_email,
             to_json, subject, sent_at, body, html, html_rev, seen, flagged, list_unsub, auto_submitted
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          rowId,
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
          HTML_REV,
          hasFlag(msg.flags, "\\Seen") ? 1 : 0,
          hasFlag(msg.flags, "\\Flagged") ? 1 : 0,
          listUnsub ? 1 : 0,
          auto && auto !== "no" ? 1 : 0,
        );
        saveImages(rowId, stored.images);
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

    // Bodies not downloaded yet, or stored before embedded images were kept: newest first.
    const stale = db
      .prepare(
        `SELECT id, uid, html FROM messages
         WHERE account_id = ? AND folder = ? AND (html IS NULL OR html_rev < ?)
         ORDER BY sent_at DESC LIMIT 200`,
      )
      .all(account.id, folder, HTML_REV) as { id: string; uid: number; html: string | null }[];
    const markFresh = db.prepare("UPDATE messages SET html_rev = ? WHERE id = ?");
    const pending: number[] = [];
    for (const row of stale) {
      // Only an <img> that lost its source (an embedded picture) is worth a new download.
      if (row.html !== null && !/<img(?![^>]*\ssrc=)[^>]*>/i.test(row.html)) {
        markFresh.run(HTML_REV, row.id);
        continue;
      }
      // Older than the sync window: the server is not asked for it again.
      if (!remoteSet.has(row.uid)) {
        if (row.html !== null) markFresh.run(HTML_REV, row.id);
        continue;
      }
      if (pending.length < 40) pending.push(row.uid);
    }
    if (pending.length > 0) {
      const older = await client.fetchAll(pending, { uid: true, source: true }, { uid: true });
      const idOf = db.prepare("SELECT id FROM messages WHERE account_id = ? AND folder = ? AND uid = ?");
      const fill = db.prepare(
        "UPDATE messages SET html = ?, html_rev = ?, body = CASE WHEN body = '' THEN ? ELSE body END WHERE id = ?",
      );
      for (const msg of older) {
        if (!msg.source) continue;
        const row = idOf.get(account.id, folder, msg.uid) as { id: string } | undefined;
        if (!row) continue;
        const stored = mailBody(await parseMail(msg.source), row.id);
        fill.run(stored.html, HTML_REV, stored.text, row.id);
        saveImages(row.id, stored.images);
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

export type SyncOptions = {
  /** Only the inbox, for a push from the server: new mail shows in seconds. */
  inboxOnly?: boolean;
};

// Accounts that got a push while a sync was already running: sync their inbox again after.
const again = new Set<string>();

export async function syncAccount(id: string, options: SyncOptions = {}) {
  return holdDb(() => syncAccountHeld(id, options));
}

async function syncAccountHeld(id: string, options: SyncOptions) {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    "UPDATE accounts SET syncing = 0 WHERE syncing = 1 AND IFNULL(syncing_since, 0) < ?",
  ).run(now - 10 * 60 * 1000);
  const claimed = db
    .prepare("UPDATE accounts SET syncing = 1, syncing_since = ? WHERE id = ? AND syncing = 0")
    .run(now, id);
  if (claimed.changes === 0) {
    // The running sync may already be past the new message.
    if (options.inboxOnly) again.add(id);
    return;
  }

  try {
    const account = loadAccount(id);
    const dirty = new Set<string>();
    const deletes: { folder: string; uid: number }[] = [];
    const inbox = options.inboxOnly ? folderPath(id, "inbox") : null;
    await withImap(account, async (client) => {
      if (inbox) {
        await syncFolder(client, account, inbox, dirty, deletes);
        return;
      }
      await refreshMailboxes(client, id);
      const folders = db
        .prepare(
          "SELECT path FROM mailboxes WHERE account_id = ? AND role IN ('inbox', 'sent', 'archive', 'trash', 'junk')",
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
    if (deletes.length > 0) dropOrphanImages();

    recomputeAccount(id, dirty);
    // Show new mail now; the AI category and summary follow.
    if (dirty.size > 0) bumpRevision();
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
    if (again.delete(id)) {
      setTimeout(() => {
        syncAccount(id, { inboxOnly: true }).catch((err) =>
          console.error("[sync]", id, err instanceof Error ? err.message : err),
        );
      }, 0);
    }
  }
}
