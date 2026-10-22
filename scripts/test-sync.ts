import { rmSync } from "node:fs";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createUser } from "../src/server/auth";
import { getDb, readRevision } from "../src/server/db";
import { mutate } from "../src/server/mutate";
import { readState } from "../src/server/state";
import { syncAccount } from "../src/server/sync";

/**
 * Against the local GreenMail server (IMAP 3143, SMTP 3025): a sync with nothing new
 * leaves the revision alone, and flags changed on another device reach the app.
 */

process.env.SORTED_DATA_DIR = `/tmp/sorted-sync-test-${Date.now()}`;
rmSync(process.env.SORTED_DATA_DIR, { recursive: true, force: true });

const USER = `sync-test-${Date.now()}@test.local`;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function thread(subject: string) {
  const found = readState().threads.find((t) => t.subject === subject);
  assert(found, `"${subject}" is missing`);
  return found;
}

async function main() {
  const smtp = nodemailer.createTransport({
    host: "127.0.0.1",
    port: 3025,
    secure: false,
    auth: { user: USER, pass: "secret" },
    tls: { rejectUnauthorized: false },
  });
  await smtp.sendMail({
    from: "Claire <claire@client.test>",
    to: USER,
    subject: "Flag me",
    text: "Hello",
    html: "<p>Hello <b>there</b></p>",
  });

  createUser("sync-test-password");
  const { id } = (await mutate({
    op: "account.create",
    provider: "imap",
    label: "Sync test",
    email: USER,
    password: "secret",
    defaultSpace: "personal",
    imapHost: "127.0.0.1",
    imapPort: 3143,
    imapSecure: false,
    smtpHost: "127.0.0.1",
    smtpPort: 3025,
    smtpSecure: false,
  })) as { id: string };
  for (let i = 0; i < 80; i += 1) {
    const row = getDb().prepare("SELECT syncing, last_sync_at FROM accounts WHERE id = ?").get(id) as {
      syncing: number;
      last_sync_at: number | null;
    };
    if (row.syncing === 0 && row.last_sync_at) break;
    await sleep(250);
  }
  await syncAccount(id);

  let t = thread("Flag me");
  assert(t.unread, "new mail should be unread");
  assert(t.messages[0].hasHtml, "the HTML part should be flagged");
  assert(!("html" in t.messages[0]), "HTML must not be sent with the mailbox list");

  const revision = readRevision();
  await syncAccount(id);
  assert(readRevision() === revision, "a sync with nothing new must not reload every open app");
  console.log("idle sync leaves the revision alone");

  // Read and starred in another mail app.
  const client = new ImapFlow({
    host: "127.0.0.1",
    port: 3143,
    secure: false,
    auth: { user: USER, pass: "secret" },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    await client.messageFlagsAdd("1:*", ["\\Seen", "\\Flagged"]);
  } finally {
    lock.release();
  }
  await client.logout();

  await syncAccount(id, { inboxOnly: true });
  t = thread("Flag me");
  assert(!t.unread && t.starred, `flags from another device were not applied (unread ${t.unread}, starred ${t.starred})`);
  assert(readRevision() !== revision, "a flag change must reach open apps");
  console.log("flags changed elsewhere reach the app");

  // Multi-select: one request archives, stars and undoes several threads.
  for (const subject of ["Bulk one", "Bulk two", "Bulk three"]) {
    await smtp.sendMail({ from: "Sam <sam@test.local>", to: USER, subject, text: "Hi" });
  }
  await syncAccount(id, { inboxOnly: true });
  const bulk = ["Bulk one", "Bulk two", "Bulk three"].map((subject) => thread(subject));
  const ids = bulk.map((b) => b.id);
  const starred = (await mutate({ op: "thread.bulk", ids, action: { kind: "star", starred: true } })) as {
    failed: number;
  };
  assert(starred.failed === 0 && ids.every((x) => readState().threads.find((b) => b.id === x)?.starred), "bulk star");
  const archived = (await mutate({ op: "thread.bulk", ids, action: { kind: "status", status: "done" } })) as {
    failed: number;
  };
  assert(archived.failed === 0, "bulk archive reported failures");
  assert(ids.every((x) => readState().threads.find((b) => b.id === x)?.status === "done"), "bulk archive");
  await syncAccount(id);
  assert(ids.every((x) => readState().threads.find((b) => b.id === x)?.status === "done"), "archive held after sync");
  await mutate({
    op: "thread.restore",
    threads: bulk.map((b) => ({ id: b.id, status: b.status, unread: b.unread, starred: b.starred })),
  });
  const restored = readState().threads.filter((b) => ids.includes(b.id));
  assert(restored.every((b) => b.status === "inbox" && !b.starred), "undo restores status and star");
  const partial = (await mutate({
    op: "thread.bulk",
    ids: [ids[0], "missing-thread"],
    action: { kind: "status", status: "done" },
  })) as { failed: number };
  assert(partial.failed === 1, "one bad thread must not stop the others");
  console.log("bulk archive, star and undo work on several threads");

  console.log("sync test passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
