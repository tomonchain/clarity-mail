import { createHash, randomUUID } from "node:crypto";
import { getDb, type MessageRow, type ThreadRow } from "./db";

export function normalizeMessageId(value: string | undefined | null): string {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

export function newThreadId(seed: string) {
  return `t-${createHash("sha1").update(seed).digest("hex").slice(0, 16)}`;
}

export function ownAddresses(accountId: string): Set<string> {
  const row = getDb()
    .prepare("SELECT email, aliases FROM accounts WHERE id = ?")
    .get(accountId) as { email: string; aliases: string } | undefined;
  const set = new Set<string>();
  if (!row) return set;
  set.add(row.email.toLowerCase());
  for (const alias of JSON.parse(row.aliases) as string[]) set.add(alias.toLowerCase());
  return set;
}

type Joined = MessageRow & { role: string | null };

export function messagesForThread(threadId: string): Joined[] {
  return getDb()
    .prepare(
      `SELECT m.*, b.role FROM messages m
       LEFT JOIN mailboxes b ON b.account_id = m.account_id AND b.path = m.folder
       WHERE m.thread_id = ? ORDER BY m.sent_at ASC, m.uid ASC`,
    )
    .all(threadId) as Joined[];
}

function snippet(body: string) {
  return body.replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Rebuild one thread from its messages. A dirty thread is queued for triage again. */
export function recomputeThread(threadId: string, dirty = false) {
  const db = getDb();
  const msgs = messagesForThread(threadId);
  const prev = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (msgs.length === 0) {
    if (prev) db.prepare("DELETE FROM threads WHERE id = ?").run(threadId);
    return;
  }
  const first = msgs[0];
  const last = msgs[msgs.length - 1];
  const inInbox = msgs.some((m) => m.role === "inbox");
  const now = Date.now();
  const keepSnooze = prev?.status === "snoozed" && prev.snoozed_until != null && prev.snoozed_until > now && !dirty;
  const status = keepSnooze ? "snoozed" : inInbox ? "inbox" : "done";
  const unread = status === "inbox" && msgs.some((m) => m.role === "inbox" && m.seen === 0) ? 1 : 0;
  const starred = msgs.some((m) => m.flagged === 1) ? 1 : 0;
  const mine = ownAddresses(first.account_id);
  const awaiting = status === "inbox" && mine.has(last.from_email.toLowerCase()) ? 1 : 0;
  const triaged = dirty ? 0 : (prev?.triaged ?? 0);
  const summary = dirty ? null : (prev?.summary ?? null);
  const summarySource = dirty ? null : (prev?.summary_source ?? null);

  db.prepare(
    `INSERT INTO threads (
       id, account_id, subject, snippet, summary, summary_source, category, triaged,
       unread, starred, status, snoozed_until, awaiting_reply, space_override
     ) VALUES (
       @id, @account_id, @subject, @snippet, @summary, @summary_source, @category, @triaged,
       @unread, @starred, @status, @snoozed_until, @awaiting_reply, @space_override
     )
     ON CONFLICT(id) DO UPDATE SET
       subject = excluded.subject,
       snippet = excluded.snippet,
       summary = excluded.summary,
       summary_source = excluded.summary_source,
       triaged = excluded.triaged,
       unread = excluded.unread,
       starred = excluded.starred,
       status = excluded.status,
       snoozed_until = excluded.snoozed_until,
       awaiting_reply = excluded.awaiting_reply`,
  ).run({
    id: threadId,
    account_id: first.account_id,
    subject: first.subject || "(no subject)",
    snippet: snippet(last.body) || first.subject,
    summary,
    summary_source: summarySource,
    category: prev?.category ?? "fyi",
    triaged,
    unread,
    starred,
    status,
    snoozed_until: keepSnooze ? prev?.snoozed_until : null,
    awaiting_reply: awaiting,
    space_override: prev?.space_override ?? null,
  });
}

export function recomputeAccount(accountId: string, dirty: Set<string> = new Set()) {
  const db = getDb();
  const ids = db
    .prepare("SELECT DISTINCT thread_id AS id FROM messages WHERE account_id = ?")
    .all(accountId) as { id: string }[];
  const keep = new Set(ids.map((r) => r.id));
  for (const id of keep) recomputeThread(id, dirty.has(id));
  const existing = db.prepare("SELECT id FROM threads WHERE account_id = ?").all(accountId) as { id: string }[];
  for (const row of existing) {
    if (!keep.has(row.id)) db.prepare("DELETE FROM threads WHERE id = ?").run(row.id);
  }
}

export function findThread(accountId: string, inReplyTo: string, references: string[]): string | null {
  const db = getDb();
  for (const mid of [inReplyTo, ...references]) {
    if (!mid) continue;
    const row = db
      .prepare("SELECT thread_id FROM messages WHERE account_id = ? AND message_id = ?")
      .get(accountId, mid) as { thread_id: string } | undefined;
    if (row) return row.thread_id;
  }
  return null;
}

export function messageId() {
  return randomUUID();
}
