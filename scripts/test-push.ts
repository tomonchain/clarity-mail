import { rmSync } from "node:fs";
import nodemailer from "nodemailer";
import { createUser } from "../src/server/auth";
import { getDb, readRevision } from "../src/server/db";
import { mutate } from "../src/server/mutate";
import { syncAccount } from "../src/server/sync";
import { pushWatcherCount, reconcilePush, stopPush } from "../src/worker/push";

// Push test: with only the IDLE watcher running (no periodic sync), new mail must land in seconds.
process.env.SORTED_DATA_DIR = `/tmp/clarity-push-test-${Date.now()}`;
rmSync(process.env.SORTED_DATA_DIR, { recursive: true, force: true });

const USER = "push-test@test.local";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const smtp = nodemailer.createTransport({
  host: "127.0.0.1",
  port: 3025,
  secure: false,
  auth: { user: USER, pass: "secret" },
  tls: { rejectUnauthorized: false },
});

async function deliver(subject: string) {
  await smtp.sendMail({ from: "Claire <claire@client.test>", to: USER, subject, text: "Pushed." });
}

function hasThread(subject: string) {
  return Boolean(getDb().prepare("SELECT id FROM threads WHERE subject = ?").get(subject));
}

async function waitFor(subject: string, limitMs: number) {
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    if (hasThread(subject)) return Date.now() - start;
    await sleep(100);
  }
  throw new Error(`"${subject}" did not arrive within ${limitMs} ms`);
}

async function main() {
  createUser("push-test-password");
  // GreenMail creates the mailbox on first delivery.
  await deliver(`Warm-up ${Date.now()}`);
  const created = (await mutate({
    op: "account.create",
    provider: "imap",
    label: "Push test",
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
  // Let the first sync (started by account.create) finish.
  for (let i = 0; i < 80; i += 1) {
    const row = getDb().prepare("SELECT syncing, last_sync_at FROM accounts WHERE id = ?").get(created.id) as {
      syncing: number;
      last_sync_at: number | null;
    };
    if (row.syncing === 0 && row.last_sync_at) break;
    await sleep(250);
  }

  await reconcilePush();
  assert(pushWatcherCount() === 1, "one watcher per mailbox");
  await sleep(1500);

  const before = readRevision();
  const first = `Push one ${Date.now()}`;
  await deliver(first);
  const took = await waitFor(first, 8000);
  assert(readRevision() > before, "the revision moves so the app refreshes");
  console.log(`pushed mail arrived in ${took} ms`);

  // Mail landing while a full sync runs is not lost.
  const second = `Push two ${Date.now()}`;
  const full = syncAccount(created.id);
  await deliver(second);
  await full;
  const took2 = await waitFor(second, 10000);
  console.log(`mail during a full sync arrived ${took2} ms after it`);

  // A deleted mail stays deleted: the push that the move itself triggers must not bring it back.
  const doomed = `Delete me ${Date.now()}`;
  await deliver(doomed);
  await waitFor(doomed, 8000);
  const doomedThread = getDb().prepare("SELECT id FROM threads WHERE subject = ?").get(doomed) as { id: string };
  await mutate({ op: "thread.status", id: doomedThread.id, status: "trash" });
  await sleep(4000);
  await syncAccount(created.id);
  const statusAfter = (
    getDb().prepare("SELECT status FROM threads WHERE id = ?").get(doomedThread.id) as { status: string } | undefined
  )?.status;
  assert(statusAfter === "trash", `deleted mail came back as ${statusAfter}`);
  const inInbox = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM messages m JOIN mailboxes b ON b.account_id = m.account_id AND b.path = m.folder
       WHERE m.thread_id = ? AND b.role = 'inbox'`,
    )
    .get(doomedThread.id) as { c: number };
  assert(inInbox.c === 0, "deleted mail is still stored in the inbox");
  console.log("deleted mail stays in Trash after push and sync");

  // Embedded pictures (cid:) are kept and served from the mailbox.
  const pictured = `Pictures ${Date.now()}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await smtp.sendMail({
    from: "Claire <claire@client.test>",
    to: USER,
    subject: pictured,
    text: "Logo inside.",
    html: '<p>Logo:</p><img src="cid:logo@clarity" alt="logo"><img src="https://example.com/remote.png" alt="remote">',
    attachments: [{ filename: "logo.png", content: png, cid: "logo@clarity", contentType: "image/png" }],
  });
  await waitFor(pictured, 8000);
  const pic = getDb()
    .prepare("SELECT m.id, m.html FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.subject = ?")
    .get(pictured) as { id: string; html: string };
  assert(pic.html.includes(`src="/api/inline/${pic.id}/0"`), `embedded image link missing: ${pic.html}`);
  assert(pic.html.includes('src="https://example.com/remote.png"'), "remote image link missing");
  const stored = getDb().prepare("SELECT mime, data FROM inline_images WHERE message_id = ?").get(pic.id) as
    | { mime: string; data: Buffer }
    | undefined;
  assert(stored && stored.mime === "image/png" && stored.data.equals(png), "embedded image not stored");

  // Mail stored before this change (image stripped) is rebuilt by the next sync.
  getDb().prepare("DELETE FROM inline_images WHERE message_id = ?").run(pic.id);
  getDb()
    .prepare("UPDATE messages SET html = ?, html_rev = 0 WHERE id = ?")
    .run('<p>Logo:</p><img alt="logo" />', pic.id);
  await syncAccount(created.id);
  const rebuilt = getDb().prepare("SELECT html, html_rev FROM messages WHERE id = ?").get(pic.id) as {
    html: string;
    html_rev: number;
  };
  assert(rebuilt.html.includes(`/api/inline/${pic.id}/0`) && rebuilt.html_rev >= 1, "old mail was not rebuilt");
  assert(getDb().prepare("SELECT 1 FROM inline_images WHERE message_id = ?").get(pic.id), "rebuilt image missing");
  console.log("embedded images stored, and old mail rebuilt");

  stopPush();
  await sleep(300);
  assert(pushWatcherCount() === 0, "watchers stop");
  console.log("push test passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    stopPush();
    process.exit(1);
  });
