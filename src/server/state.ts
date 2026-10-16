import { looksLikeHtml } from "@/lib/mail-format";
import type { Account, Category, RoutingRule, Space, Thread } from "@/lib/types";
import { getDb, readMailboxNotice, readRevision, type AccountRow, type ThreadRow } from "./db";
import { cleanMailHtml } from "./html";
import { messagesForThread } from "./threads";

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

  const threads: Thread[] = (db.prepare("SELECT * FROM threads").all() as ThreadRow[]).map((row) => ({
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
    messages: messagesForThread(row.id).map((msg) => ({
      id: msg.id,
      from: { name: msg.from_name, email: msg.from_email },
      to: parseJson<string[]>(msg.to_json, []),
      sentAt: msg.sent_at,
      body: msg.body,
      html: msg.html
        ? cleanMailHtml(msg.html)
        : looksLikeHtml(msg.body)
          ? cleanMailHtml(msg.body)
          : undefined,
    })),
  }));

  return { spaces, accounts, rules, threads, revision: readRevision(), notice: readMailboxNotice() };
}
