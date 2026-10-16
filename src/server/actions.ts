import { randomUUID } from "node:crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import { getDb, type MessageRow, type ThreadRow } from "./db";
import { loadAccount, smtpTransport, withImap } from "./connection";
import { folderPath, refreshMailboxes } from "./sync";
import { messageId, messagesForThread, ownAddresses, recomputeThread } from "./threads";

class ActionError extends Error {}

export function isActionError(err: unknown): err is ActionError {
  return err instanceof ActionError;
}

async function moveRows(accountId: string, ids: string[], role: "inbox" | "archive" | "trash") {
  if (ids.length === 0) return;
  const db = getDb();
  const account = loadAccount(accountId);
  await withImap(account, async (client) => {
    await refreshMailboxes(client, accountId);
    const dest = folderPath(accountId, role);
    if (!dest) throw new ActionError(`This account has no ${role} folder.`);
    for (const id of ids) {
      const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
      if (!msg || msg.folder === dest) continue;
      const lock = await client.getMailboxLock(msg.folder);
      try {
        const moved = await client.messageMove(String(msg.uid), dest, { uid: true });
        if (!moved) throw new ActionError("The mail server refused to move a message.");
        const nextUid = moved.uidMap?.get(msg.uid) ?? msg.uid;
        db.prepare("UPDATE messages SET folder = ?, uid = ? WHERE id = ?").run(dest, nextUid, msg.id);
      } finally {
        lock.release();
      }
    }
  });
}

export async function setThreadStatus(
  threadId: string,
  status: "inbox" | "done" | "snoozed",
  until?: number,
) {
  const db = getDb();
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId) as ThreadRow | undefined;
  if (!thread) throw new ActionError("Thread not found.");
  const rows = messagesForThread(threadId);
  if (status === "inbox") {
    await moveRows(
      thread.account_id,
      rows.filter((m) => m.role === "archive" || m.role === "trash").map((m) => m.id),
      "inbox",
    );
  } else {
    await moveRows(
      thread.account_id,
      rows.filter((m) => m.role === "inbox").map((m) => m.id),
      "archive",
    );
  }
  recomputeThread(threadId);
  if (status === "snoozed") {
    db.prepare("UPDATE threads SET status = 'snoozed', snoozed_until = ?, unread = 0 WHERE id = ?").run(
      until ?? Date.now() + 24 * 60 * 60 * 1000,
      threadId,
    );
  }
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

  await smtpTransport(account).sendMail(mail);

  const raw = await new MailComposer(mail).compile().build();
  let storedUid = 0;
  let sentPath = "";
  await withImap(account, async (client) => {
    await refreshMailboxes(client, account.id);
    sentPath = folderPath(account.id, "sent") ?? "Sent";
    if (!folderPath(account.id, "sent")) {
      await client.mailboxCreate(sentPath);
      getDb()
        .prepare(
          "INSERT INTO mailboxes (account_id, path, role, uid_validity) VALUES (?, ?, 'sent', NULL) ON CONFLICT DO NOTHING",
        )
        .run(account.id, sentPath);
    }
    const appended = await client.append(sentPath, raw, ["\\Seen"]);
    if (appended && appended.uid) storedUid = appended.uid;
  });

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
