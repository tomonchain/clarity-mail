import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createUser, hasUser } from "../src/server/auth";
import { getDb } from "../src/server/db";
import { mutate } from "../src/server/mutate";

const MAILBOX = "sorted-test@test.local";
const MAIL_PASSWORD = "secret";
const APP_PASSWORD = process.env.SORTED_DEV_PASSWORD || "sorted-dev";

function imap() {
  return new ImapFlow({
    host: "127.0.0.1",
    port: 3143,
    secure: false,
    auth: { user: MAILBOX, pass: MAIL_PASSWORD },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
}

async function inboxCount() {
  const client = imap();
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search({ all: true }, { uid: true });
    return Array.isArray(uids) ? uids.length : 0;
  } finally {
    lock.release();
    await client.logout();
  }
}

async function seedMail() {
  const smtp = nodemailer.createTransport({
    host: "127.0.0.1",
    port: 3025,
    secure: false,
    auth: { user: MAILBOX, pass: MAIL_PASSWORD },
    tls: { rejectUnauthorized: false },
  });
  const launch = await smtp.sendMail({
    from: "Claire <claire@client.test>",
    to: MAILBOX,
    subject: "Launch date",
    text: "First note, no question.",
  });
  await smtp.sendMail({
    from: "Sam <sam@test.local>",
    to: MAILBOX,
    subject: "Re: Launch date",
    text: "Can we lock the launch? I need a yes or no by Friday.",
    inReplyTo: launch.messageId,
    references: launch.messageId,
  });
  await smtp.sendMail({
    from: "Claire <claire@client.test>",
    to: MAILBOX,
    subject: "Can you confirm the daily rate by Thursday?",
    text: "Could you confirm your daily rate by Thursday EOD?",
  });
  await smtp.sendMail({
    from: "Letters <letters@substack.test>",
    to: MAILBOX,
    subject: "Weekly digest",
    text: "Five links, nothing to do.",
    headers: { "List-Unsubscribe": "<mailto:unsub@letters.test>" },
  });
  await smtp.sendMail({
    from: "OVH <noreply@ovh.test>",
    to: MAILBOX,
    subject: "Your invoice is ready",
    text: "Invoice INV-2041 for the MX Plan. Payment received.",
  });
}

async function waitUntilSynced(id: string) {
  const db = getDb();
  for (let i = 0; i < 80; i += 1) {
    const row = db
      .prepare("SELECT syncing, sync_error, last_sync_at FROM accounts WHERE id = ?")
      .get(id) as { syncing: number; sync_error: string | null; last_sync_at: number | null };
    if (row.syncing === 0 && (row.last_sync_at || row.sync_error)) {
      if (row.sync_error) throw new Error(row.sync_error);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Sync did not finish.");
}

async function main() {
  if (!hasUser()) {
    createUser(APP_PASSWORD);
    console.log("created the dev login");
  }

  const count = await inboxCount();
  if (count === 0) {
    await seedMail();
    console.log("sent sample mail to the local mailbox");
  }

  const existing = getDb().prepare("SELECT id FROM accounts WHERE email = ?").get(MAILBOX) as
    | { id: string }
    | undefined;
  if (existing) {
    console.log("local mailbox already connected", existing.id);
    return;
  }

  const created = await mutate({
    op: "account.create",
    provider: "imap",
    label: "Local test",
    email: MAILBOX,
    password: MAIL_PASSWORD,
    defaultSpace: "personal",
    imapHost: "127.0.0.1",
    imapPort: 3143,
    imapSecure: false,
    smtpHost: "127.0.0.1",
    smtpPort: 3025,
    smtpSecure: false,
  });
  const id = (created as { id: string }).id;
  await waitUntilSynced(id);
  const threads = getDb().prepare("SELECT COUNT(*) AS c FROM threads").get() as { c: number };
  console.log(`connected ${MAILBOX} (${threads.c} threads)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
