import { createCipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3-multiple-ciphers";

// An older install: a plain database, and the key file that sealed the mailbox passwords.
const dir = `/tmp/clarity-vault-test-${Date.now()}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
process.env.SORTED_DATA_DIR = dir;
// The Keychain key the Mac app now passes (here through SORTED_SECRET, the same code path after loading).
process.env.SORTED_SECRET = randomBytes(32).toString("hex");

const legacyKey = randomBytes(32);
writeFileSync(path.join(dir, "secret"), legacyKey.toString("hex"), { mode: 0o600 });

function sealLegacy(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", legacyKey, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const file = path.join(dir, "sorted.db");
const old = new Database(file);
old.pragma("journal_mode = WAL");
old.exec(`
CREATE TABLE accounts (
  id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT NOT NULL, provider TEXT NOT NULL,
  username TEXT NOT NULL, secret TEXT NOT NULL, imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL,
  imap_secure INTEGER NOT NULL, smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
  default_space TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', last_sync_at INTEGER, sync_error TEXT,
  syncing INTEGER NOT NULL DEFAULT 0, syncing_since INTEGER
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, thread_id TEXT NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
  message_id TEXT NOT NULL DEFAULT '', in_reply_to TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL,
  from_email TEXT NOT NULL, to_json TEXT NOT NULL, subject TEXT NOT NULL, sent_at INTEGER NOT NULL, body TEXT NOT NULL,
  seen INTEGER NOT NULL, flagged INTEGER NOT NULL, list_unsub INTEGER NOT NULL DEFAULT 0,
  auto_submitted INTEGER NOT NULL DEFAULT 0, UNIQUE (account_id, folder, uid)
);
`);
old
  .prepare(
    `INSERT INTO accounts VALUES ('a1', 'Perso', 'me@test.local', 'imap', 'me', ?, 'imap.test', 993, 1,
     'smtp.test', 465, 1, 'personal', '[]', NULL, NULL, 0, NULL)`,
  )
  .run(sealLegacy("mailbox-password"));
const insert = old.prepare(
  `INSERT INTO messages (id, account_id, thread_id, folder, uid, from_name, from_email, to_json, subject, sent_at, body, seen, flagged)
   VALUES (?, 'a1', 't1', 'INBOX', ?, 'Sam', 'sam@test.local', '[]', 'Confidential salary review', 0, 'The body of a private mail', 0, 0)`,
);
for (let i = 0; i < 200; i += 1) insert.run(`m${i}`, i);
old.close();
writeFileSync(path.join(dir, "sorted.damaged.db"), readFileSync(file));
assert(readFileSync(file).includes("Confidential salary review"), "the fixture should start readable");

async function main() {
  const { getDb, dbPath, checkpointDb, isPlaintextDatabase } = await import("../src/server/db");
  const { decryptSecret } = await import("../src/server/crypto");
  const auth = await import("../src/server/auth");

  const db = getDb();
  const count = db.prepare("SELECT count(*) AS c FROM messages").get() as { c: number };
  assert(count.c === 200, `expected 200 messages after migration, got ${count.c}`);
  checkpointDb();

  assert(!isPlaintextDatabase(dbPath()), "the mailbox is still a plain SQLite file");
  for (const name of ["sorted.db", "sorted.db-wal"]) {
    const target = path.join(dir, name);
    if (existsSync(target)) assert(!readFileSync(target).includes("Confidential"), `${name} still holds readable mail`);
  }
  assert(!existsSync(path.join(dir, "sorted.damaged.db")), "a plain repair copy was left behind");
  assert(!existsSync(path.join(dir, "secret")), "the old key file was not deleted");
  assert(!existsSync(path.join(dir, "sorted.db.encrypting")), "the temporary copy was left behind");

  const row = db.prepare("SELECT secret FROM accounts WHERE id = 'a1'").get() as { secret: string };
  assert(decryptSecret(row.secret) === "mailbox-password", "the mailbox password was not sealed with the new key");

  // Without the key, or with another key, nothing opens.
  const stranger = new Database(dbPath());
  let refused = false;
  try {
    stranger.prepare("SELECT count(*) FROM messages").get();
  } catch {
    refused = true;
  }
  stranger.close();
  assert(refused, "the mailbox opened without its key");

  // Sessions: random, revocable, stored as hashes.
  auth.createUser("vault-password-1");
  assert(auth.startSession("wrong-password") === null, "a wrong password opened a session");
  const token = auth.startSession("vault-password-1");
  assert(token && auth.sessionValid(token), "a good password did not open a session");
  const stored = db.prepare("SELECT token FROM sessions").all() as { token: string }[];
  assert(!stored.some((s) => s.token === token), "the session token is stored in clear");
  const other = auth.issueSession();
  auth.changePassword("vault-password-1", "vault-password-2");
  auth.endOtherSessions(token);
  assert(!auth.sessionValid(other), "changing the password left other sessions open");
  assert(auth.sessionValid(token), "changing the password closed the current session");
  assert(auth.startSession("vault-password-1") === null, "the old password still works");
  auth.endSession(token);
  assert(!auth.sessionValid(token), "signing out did not end the session");

  rmSync(dir, { recursive: true, force: true });
  console.log("vault test passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
