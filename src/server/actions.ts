import { randomUUID } from "node:crypto";
import type { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer";
import { dropOrphanImages, getDb, type MessageRow, type ThreadRow } from "./db";
import { loadAccount, smtpTransport, withImap, type MailAccount } from "./connection";
import { ensureFolder, folderPath, refreshMailboxes, type FolderRole } from "./sync";
import { messageId, messagesForThread, ownAddresses, recomputeThread } from "./threads";

class ActionError extends Error {}

export function isActionError(err: unknown): err is ActionError {
  return err instanceof ActionError;
}

async function moveOne(client: ImapFlow, msg: MessageRow, dest: string) {
  const lock = await client.getMailboxLock(msg.folder);
  try {
    return await client.messageMove(String(msg.uid), dest, { uid: true });
  } finally {
    lock.release();
  }
}

async function moveRows(accountId: string, ids: string[], role: FolderRole) {
  if (ids.length === 0) return;
  const db = getDb();
  const account = loadAccount(accountId);
  await withImap(account, async (client) => {
    // Listing every folder costs a round trip: only when the destination is not known yet,
    // or when a move fails (a folder renamed since the last sync).
    let listed = false;
    if (!folderPath(accountId, role)) {
      await refreshMailboxes(client, accountId);
      listed = true;
    }
    let dest = await ensureFolder(client, accountId, role);
    for (const id of ids) {
      const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
      if (!msg || msg.folder === dest) continue;
      const failures: unknown[] = [];
      let moved = await moveOne(client, msg, dest).catch((err: unknown) => {
        failures.push(err);
        return false as const;
      });
      if (!moved && !listed) {
        await refreshMailboxes(client, accountId);
        listed = true;
        dest = await ensureFolder(client, accountId, role);
        moved = await moveOne(client, msg, dest).catch((err: unknown) => {
          failures.push(err);
          return false as const;
        });
      }
      if (!moved) {
        const last = failures.at(-1);
        const detail = last instanceof Error ? ` ${last.message}` : "";
        throw new ActionError(`The mail server refused to move a message.${detail}`);
      }
      const nextUid = moved.uidMap?.get(msg.uid) ?? msg.uid;
      db.prepare("UPDATE messages SET folder = ?, uid = ? WHERE id = ?").run(dest, nextUid, msg.id);
    }
  });
}

export type SettableStatus = "inbox" | "done" | "snoozed" | "trash" | "spam";

/** Where each status files a thread's messages, and which folders it takes them from. */
const STATUS_MOVES: Record<SettableStatus, { to: FolderRole; from: string[] }> = {
  inbox: { to: "inbox", from: ["archive", "trash", "junk"] },
  done: { to: "archive", from: ["inbox", "trash", "junk"] },
  snoozed: { to: "archive", from: ["inbox", "trash", "junk"] },
  trash: { to: "trash", from: ["inbox", "archive", "junk"] },
  spam: { to: "junk", from: ["inbox", "archive", "trash"] },
};

export async function setThreadStatus(threadId: string, status: SettableStatus, until?: number) {
  const db = getDb();
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (!thread) throw new ActionError("Thread not found.");
  const rows = messagesForThread(threadId);
  const move = STATUS_MOVES[status];
  await moveRows(
    thread.account_id,
    rows.filter((m) => m.role !== null && move.from.includes(m.role)).map((m) => m.id),
    move.to,
  );
  recomputeThread(threadId);
  if (status === "snoozed") {
    db.prepare("UPDATE threads SET status = 'snoozed', snoozed_until = ?, unread = 0 WHERE id = ?").run(
      until ?? Date.now() + 24 * 60 * 60 * 1000,
      threadId,
    );
  }
}

/** Delete a thread's messages from Trash and Spam for good. Messages kept elsewhere stay. */
export async function purgeThread(threadId: string) {
  const db = getDb();
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (!thread) throw new ActionError("Thread not found.");
  const rows = messagesForThread(threadId).filter((m) => m.role === "trash" || m.role === "junk");
  if (rows.length === 0) return;
  const account = loadAccount(thread.account_id);
  await withImap(account, async (client) => {
    const byFolder = new Map<string, typeof rows>();
    for (const row of rows) byFolder.set(row.folder, [...(byFolder.get(row.folder) ?? []), row]);
    for (const [folder, list] of byFolder) {
      const lock = await client.getMailboxLock(folder);
      try {
        const ok = await client.messageDelete(list.map((m) => m.uid).join(","), { uid: true });
        if (!ok) throw new ActionError("The mail server refused to delete a message.");
      } finally {
        lock.release();
      }
    }
  });
  const remove = db.prepare("DELETE FROM messages WHERE id = ?");
  for (const row of rows) remove.run(row.id);
  dropOrphanImages();
  recomputeThread(threadId);
}

export async function wakeSnoozes() {
  const due = getDb()
    .prepare("SELECT id FROM threads WHERE status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?")
    .all(Date.now()) as { id: string }[];
  for (const row of due) {
    await setThreadStatus(row.id, "inbox");
    const latest = messagesForThread(row.id).at(-1);
    if (latest) await setMessageFlag(latest.id, "\\Seen", false);
  }
}

export async function setMessageFlag(id: string, flag: "\\Seen" | "\\Flagged", add: boolean) {
  const db = getDb();
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
  if (!msg) throw new ActionError("Message not found.");
  const account = loadAccount(msg.account_id);
  await withImap(account, async (client) => {
    const lock = await client.getMailboxLock(msg.folder);
    try {
      const ok = add
        ? await client.messageFlagsAdd(String(msg.uid), [flag], { uid: true })
        : await client.messageFlagsRemove(String(msg.uid), [flag], { uid: true });
      if (!ok) throw new ActionError("The mail server refused to update flags.");
    } finally {
      lock.release();
    }
  });
  if (flag === "\\Seen") db.prepare("UPDATE messages SET seen = ? WHERE id = ?").run(add ? 1 : 0, id);
  else db.prepare("UPDATE messages SET flagged = ? WHERE id = ?").run(add ? 1 : 0, id);
  recomputeThread(msg.thread_id);
}

export async function setThreadUnread(threadId: string, unread: boolean) {
  const inbox = messagesForThread(threadId).filter((m) => m.role === "inbox");
  const target = inbox.at(-1) ?? messagesForThread(threadId).at(-1);
  if (!target) return;
  await setMessageFlag(target.id, "\\Seen", !unread);
}

export async function setThreadStar(threadId: string, starred: boolean) {
  const target = messagesForThread(threadId).at(-1);
  if (!target) return;
  await setMessageFlag(target.id, "\\Flagged", starred);
}

type Outgoing = {
  from: string;
  to: string | string[];
  cc?: string[];
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
};

/** Gmail files every message sent through its SMTP server in Sent Mail on its own. */
function serverFilesSent(account: MailAccount) {
  return /(^|\.)(gmail|googlemail)\.com$/i.test(account.smtpHost);
}

/**
 * Send through the account's SMTP server, then append a copy to its Sent folder.
 * Once SMTP accepted the mail, a failed copy is only logged: reporting an error
 * there would invite sending the same mail twice.
 */
async function sendAndFile(account: MailAccount, mail: Outgoing): Promise<{ uid: number; path: string }> {
  await smtpTransport(account).sendMail(mail);
  if (serverFilesSent(account)) return { uid: 0, path: "" };

  const raw = await new MailComposer(mail).compile().build();
  let uid = 0;
  let path = "";
  try {
    await withImap(account, async (client) => {
      await refreshMailboxes(client, account.id);
      path = folderPath(account.id, "sent") ?? "Sent";
      if (!folderPath(account.id, "sent")) {
        await client.mailboxCreate(path);
        getDb()
          .prepare(
            "INSERT INTO mailboxes (account_id, path, role, uid_validity) VALUES (?, ?, 'sent', NULL) ON CONFLICT DO NOTHING",
          )
          .run(account.id, path);
      }
      const appended = await client.append(path, raw, ["\\Seen"]);
      if (appended && appended.uid) uid = appended.uid;
    });
  } catch (err) {
    console.error("[send] sent, but could not file a copy in Sent:", err instanceof Error ? err.message : err);
  }
  return { uid, path };
}

/** A new message (not a reply). Returns the id of the account it was sent from. */
export async function sendNew(input: { from: string; to: string[]; cc: string[]; subject: string; body: string }) {
  const from = input.from.trim().toLowerCase();
  const ids = (getDb().prepare("SELECT id FROM accounts").all() as { id: string }[]).map((r) => r.id);
  const accountId = ids.find((id) => ownAddresses(id).has(from));
  if (!accountId) throw new ActionError("Send from one of your connected addresses.");
  if (input.to.length === 0) throw new ActionError("Add at least one recipient.");
  const text = input.body.trim();
  if (!text) throw new ActionError("Write a message before sending.");
  const account = loadAccount(accountId);
  await sendAndFile(account, {
    from,
    to: input.to,
    cc: input.cc.length > 0 ? input.cc : undefined,
    subject: input.subject.trim() || "(no subject)",
    text,
    messageId: `<${messageId()}@clarity.mail>`,
  });
  return accountId;
}

export async function sendReply(threadId: string, from: string, body: string) {
  const db = getDb();
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (!thread) throw new ActionError("Thread not found.");
  const text = body.trim();
  if (!text) throw new ActionError("Write a message before sending.");
  const account = loadAccount(thread.account_id);
  const mine = ownAddresses(thread.account_id);
  if (!mine.has(from.toLowerCase())) throw new ActionError("Send from an address on this account.");

  const msgs = messagesForThread(threadId);
  const last = msgs.at(-1);
  if (!last) throw new ActionError("Thread is empty.");
  const recipient =
    [...msgs].reverse().find((m) => !mine.has(m.from_email.toLowerCase()))?.from_email ?? last.from_email;
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const id = messageId();
  const fullId = `<${id}@clarity.mail>`;
  const inReplyTo = last.message_id ? `<${last.message_id}>` : undefined;
  const mail = {
    from,
    to: recipient,
    subject,
    text,
    messageId: fullId,
    inReplyTo,
    references: inReplyTo,
  };

  const filed = await sendAndFile(account, mail);
  const storedUid = filed.uid;
  const sentPath = filed.path;

  if (storedUid > 0) {
    db.prepare(
      `INSERT INTO messages (
         id, account_id, thread_id, folder, uid, message_id, in_reply_to, from_name, from_email,
         to_json, subject, sent_at, body, seen, flagged, list_unsub, auto_submitted
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0)`,
    ).run(
      randomUUID(),
      account.id,
      threadId,
      sentPath,
      storedUid,
      id,
      last.message_id,
      account.label,
      from.toLowerCase(),
      JSON.stringify([recipient]),
      subject,
      Date.now(),
      text,
    );
    recomputeThread(threadId, true);
  }
}
