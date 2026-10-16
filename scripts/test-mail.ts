import { rmSync } from "node:fs";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createUser } from "../src/server/auth";
import { getDb } from "../src/server/db";
import { mutate } from "../src/server/mutate";
import { sendReply } from "../src/server/actions";
import { readState } from "../src/server/state";

process.env.SORTED_DATA_DIR = `/tmp/sorted-mail-test-${Date.now()}`;
rmSync(process.env.SORTED_DATA_DIR, { recursive: true, force: true });

const USER = "sorted-test@test.local";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const smtp = nodemailer.createTransport({
  host: "127.0.0.1",
  port: 3025,
  secure: false,
  auth: { user: USER, pass: "secret" },
  tls: { rejectUnauthorized: false },
});

async function deliver(subject: string, text: string, extra: Record<string, unknown> = {}) {
  const info = await smtp.sendMail({
    from: "Claire <claire@client.test>",
    to: USER,
    subject,
    text,
    ...extra,
  });
  return info.messageId as string;
}

async function emptyMailbox(user: string, mailbox: string) {
  const client = new ImapFlow({
    host: "127.0.0.1",
    port: 3143,
    secure: false,
    auth: { user, pass: "secret" },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = await client.search({ all: true }, { uid: true });
      if (Array.isArray(uids) && uids.length > 0) await client.messageDelete(uids, { uid: true });
    } finally {
      lock.release();
    }
  } catch {
    // The folder does not exist yet.
  }
  await client.logout();
}

async function main() {
  for (const box of ["INBOX", "Archive", "Sent", "Trash"]) {
    await emptyMailbox(USER, box);
    await emptyMailbox("sam@test.local", box);
  }

  const launchId = await deliver("Launch date", "First note, no question.");
  await deliver("Re: Launch date", "Can we lock the launch? I need a yes or no by Friday.", {
    inReplyTo: launchId,
    references: launchId,
    from: "Sam <sam@test.local>",
  });
  await deliver("Can you confirm the daily rate by Thursday?", "Could you confirm your daily rate by Thursday EOD?");
  await deliver("Weekly digest", "Five links, nothing to do.", {
    headers: { "List-Unsubscribe": "<mailto:unsub@letters.test>" },
  });

  createUser("test-password-123");
  await mutate({
    op: "account.create",
    provider: "imap",
    label: "Test",
    email: USER,
    password: "secret",
    defaultSpace: "personal",
    imapHost: "127.0.0.1",
    imapPort: 3143,
    imapSecure: false,
    smtpHost: "127.0.0.1",
    smtpPort: 3025,
    smtpSecure: false,
  });

  let state = readState();
  for (let i = 0; i < 40 && (state.accounts[0]?.syncing || state.threads.length < 3); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    state = readState();
  }

  const account = state.accounts[0];
  console.log(
    "threads",
    state.threads.map((t) => ({
      subject: t.subject,
      category: t.category,
      messages: t.messages.length,
      status: t.status,
    })),
  );
  if (account?.syncError) console.log("sync error", account.syncError);
  assert(account && !account.syncError, `sync failed: ${account?.syncError}`);
  assert(state.threads.length >= 3, `expected at least 3 threads, got ${state.threads.length}`);

  const launch = state.threads.find((t) => t.subject.toLowerCase().includes("launch"));
  assert(launch && launch.messages.length === 2, "launch thread was not joined");
  assert(launch.category === "needs-reply", `launch category was ${launch.category}`);

  const news = state.threads.find((t) => t.subject === "Weekly digest");
  assert(news?.category === "newsletter", `newsletter category was ${news?.category}`);

  await mutate({ op: "thread.status", id: news!.id, status: "done" });
  state = readState();
  const archived = state.threads.find((t) => t.id === news!.id);
  assert(archived?.status === "done", "archive did not mark the thread done");

  const client = new ImapFlow({
    host: "127.0.0.1",
    port: 3143,
    secure: false,
    auth: { user: USER, pass: "secret" },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  await client.connect();
  const inbox = await client.getMailboxLock("INBOX");
  let stillThere = false;
  try {
    const uids = await client.search({ subject: "Weekly digest" }, { uid: true });
    stillThere = Array.isArray(uids) && uids.length > 0;
  } finally {
    inbox.release();
  }
  assert(!stillThere, "newsletter is still in the inbox");

  await sendReply(launch.id, USER, "Yes, Tuesday works.");
  const sam = new ImapFlow({
    host: "127.0.0.1",
    port: 3143,
    secure: false,
    auth: { user: "sam@test.local", pass: "secret" },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  await sam.connect();
  const samInbox = await sam.getMailboxLock("INBOX");
  try {
    const uids = await sam.search({ from: USER }, { uid: true });
    assert(Array.isArray(uids) && uids.length > 0, "Sam did not receive the reply");
  } finally {
    samInbox.release();
  }
  await sam.logout();
  await client.logout();

  const rows = getDb().prepare("SELECT COUNT(*) AS c FROM messages").get() as { c: number };
  assert(rows.c >= 4, "messages were not stored");
  console.log("mail sync test passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
