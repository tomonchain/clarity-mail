import { looksLikeHtml } from "@/lib/mail-format";
import type { Account, Category, RoutingRule, Space, Thread } from "@/lib/types";
import type { Message } from "@/lib/types";
import { getDb, readMailboxNotice, readRevision, type AccountRow, type ThreadRow } from "./db";

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function readState(): {
  spaces: Space[];
  accounts: Account[];
  rules: RoutingRule[];
  threads: Thread[];
  revision: number;
  notice: string | null;
} {
  const db = getDb();
  const spaces = (
    db.prepare("SELECT * FROM spaces ORDER BY position, name").all() as {
      id: string;
      name: string;
      description: string;
      color: string;
      vips: string;
      focus_hours: string | null;
      sla_hours: number | null;
    }[]
  ).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    vips: parseJson<string[]>(row.vips, []),
    focusHours: parseJson(row.focus_hours, undefined),
    slaHours: row.sla_hours ?? undefined,
  }));

  const accounts: Account[] = (db.prepare("SELECT * FROM accounts ORDER BY label").all() as AccountRow[]).map(
    (row) => ({
      id: row.id,
      label: row.label,
      email: row.email,
      provider: row.provider as Account["provider"],
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      defaultSpace: row.default_space,
      aliases: parseJson<string[]>(row.aliases, []),
      lastSyncAt: row.last_sync_at,
      syncError: row.sync_error,
      syncing: row.syncing === 1,
    }),
  );

  const rules: RoutingRule[] = (
    db.prepare("SELECT * FROM rules ORDER BY position, id").all() as {
      id: string;
      field: RoutingRule["field"];
      value: string;
      space_id: string | null;
      category: string | null;
    }[]
  ).map((row) => ({
    id: row.id,
    field: row.field,
    value: row.value,
    space: row.space_id ?? undefined,
    category: (row.category as Category | null) ?? undefined,
  }));

  // Every message in one query, without the HTML: the reader loads it from /api/messages/[id]
  // when a message is opened, so the mailbox list stays small and fast to send.
  const byThread = new Map<string, Message[]>();
  const messageRows = db
    .prepare(
      `SELECT m.id, m.thread_id, m.from_name, m.from_email, m.to_json, m.sent_at, m.body,
              (m.html IS NOT NULL AND m.html != '') AS has_html, b.role
       FROM messages m
       LEFT JOIN mailboxes b ON b.account_id = m.account_id AND b.path = m.folder
       ORDER BY m.sent_at ASC, m.uid ASC`,
    )
    .all() as {
    id: string;
    thread_id: string;
    from_name: string;
    from_email: string;
    to_json: string;
    sent_at: number;
    body: string;
    has_html: number;
    role: string | null;
  }[];
  for (const msg of messageRows) {
    let list = byThread.get(msg.thread_id);
    if (!list) byThread.set(msg.thread_id, (list = []));
    list.push({
      id: msg.id,
      from: { name: msg.from_name, email: msg.from_email },
      to: parseJson<string[]>(msg.to_json, []),
      sentAt: msg.sent_at,
      body: msg.body,
      hasHtml: msg.has_html === 1 || looksLikeHtml(msg.body),
      folder: msg.role ?? "other",
    });
  }

  const threads: Thread[] = [];
  for (const row of db.prepare("SELECT * FROM threads").all() as ThreadRow[]) {
    const messages = byThread.get(row.id);
    // A thread caught between a sync deleting its last message and the recompute: skip it.
    if (!messages?.length) continue;
    threads.push({
      id: row.id,
      accountId: row.account_id,
      subject: row.subject,
      snippet: row.snippet,
      summary: row.summary ?? undefined,
      summarySource: row.summary_source === "ai" ? "ai" : undefined,
      category: row.category as Thread["category"],
      unread: row.unread === 1,
      starred: row.starred === 1,
      status: row.status as Thread["status"],
      snoozedUntil: row.snoozed_until ?? undefined,
      awaitingReply: row.awaiting_reply === 1,
      spaceOverride: row.space_override ?? undefined,
      messages,
    });
  }

  return { spaces, accounts, rules, threads, revision: readRevision(), notice: readMailboxNotice() };
}
