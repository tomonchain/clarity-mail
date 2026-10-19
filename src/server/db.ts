import Database from "better-sqlite3-multiple-ciphers";
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { SEED_RULES, SEED_SPACES } from "@/lib/seed";
import {
  canDecryptSecret,
  dataDir,
  decryptWith,
  derivedKey,
  encryptSecret,
  legacyKey,
  legacyKeyFile,
} from "./crypto";

export type AccountRow = {
  id: string;
  label: string;
  email: string;
  provider: string;
  username: string;
  secret: string;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  default_space: string;
  aliases: string;
  last_sync_at: number | null;
  sync_error: string | null;
  syncing: number;
  syncing_since: number | null;
};

export type ThreadRow = {
  id: string;
  account_id: string;
  subject: string;
  snippet: string;
  summary: string | null;
  summary_source: string | null;
  category: string;
  triaged: number;
  unread: number;
  starred: number;
  status: string;
  snoozed_until: number | null;
  awaiting_reply: number;
  space_override: string | null;
};

export type MessageRow = {
  id: string;
  account_id: string;
  thread_id: string;
  folder: string;
  uid: number;
  message_id: string;
  in_reply_to: string;
  from_name: string;
  from_email: string;
  to_json: string;
  subject: string;
  sent_at: number;
  body: string;
  html: string | null;
  html_rev: number;
  seen: number;
  flagged: number;
  list_unsub: number;
  auto_submitted: number;
};

/** Bump when stored mail HTML must be rebuilt from the source (1: embedded images kept). */
export const HTML_REV = 1;

/** Embedded images whose message is gone. */
export function dropOrphanImages() {
  getDb().prepare("DELETE FROM inline_images WHERE message_id NOT IN (SELECT id FROM messages)").run();
}

let singleton: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  vips TEXT NOT NULL DEFAULT '[]',
  focus_hours TEXT,
  sla_hours INTEGER,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT NOT NULL,
  provider TEXT NOT NULL,
  username TEXT NOT NULL,
  secret TEXT NOT NULL,
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL,
  imap_secure INTEGER NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_secure INTEGER NOT NULL,
  default_space TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  last_sync_at INTEGER,
  sync_error TEXT,
  syncing INTEGER NOT NULL DEFAULT 0,
  syncing_since INTEGER
);
CREATE TABLE IF NOT EXISTS mailboxes (
  account_id TEXT NOT NULL,
  path TEXT NOT NULL,
  role TEXT NOT NULL,
  uid_validity TEXT,
  PRIMARY KEY (account_id, path)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  uid INTEGER NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  in_reply_to TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  seen INTEGER NOT NULL,
  flagged INTEGER NOT NULL,
  list_unsub INTEGER NOT NULL DEFAULT 0,
  auto_submitted INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, folder, uid)
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL DEFAULT '',
  summary TEXT,
  summary_source TEXT,
  category TEXT NOT NULL DEFAULT 'fyi',
  triaged INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inbox',
  snoozed_until INTEGER,
  awaiting_reply INTEGER NOT NULL DEFAULT 0,
  space_override TEXT
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  space_id TEXT,
  category TEXT,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS inline_images (
  message_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (message_id, idx)
);
CREATE INDEX IF NOT EXISTS messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS messages_msgid ON messages(account_id, message_id);
`;

function seedDefaults(db: Database.Database) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM spaces").get() as { c: number };
  if (count.c > 0) return;
  const insertSpace = db.prepare(
    `INSERT INTO spaces (id, name, description, color, vips, focus_hours, sla_hours, position)
     VALUES (@id, @name, @description, @color, @vips, @focus_hours, @sla_hours, @position)`,
  );
  const insertRule = db.prepare(
    `INSERT INTO rules (id, field, value, space_id, category, position)
     VALUES (@id, @field, @value, @space_id, @category, @position)`,
  );
  const tx = db.transaction(() => {
    SEED_SPACES.forEach((s, i) => {
      insertSpace.run({
        id: s.id,
        name: s.name,
        description: s.description,
        color: s.color,
        vips: JSON.stringify(s.vips),
        focus_hours: s.focusHours ? JSON.stringify(s.focusHours) : null,
        sla_hours: s.slaHours ?? null,
        position: i,
      });
    });
    SEED_RULES.forEach((r, i) => {
      insertRule.run({
        id: r.id,
        field: r.field,
        value: r.value,
        space_id: r.space ?? null,
        category: r.category ?? null,
        position: i,
      });
    });
  });
  tx();
}

const PLAIN_HEADER = Buffer.from("SQLite format 3\0", "latin1");

/** True for a readable, unencrypted SQLite file. Encrypted pages look like random bytes. */
export function isPlaintextDatabase(file: string) {
  if (!existsSync(file)) return false;
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    return readSync(fd, head, 0, 16, 0) === 16 && head.equals(PLAIN_HEADER);
  } finally {
    closeSync(fd);
  }
}

/** SQLCipher v4 (AES-256-CBC, HMAC-SHA512 per page), keyed with a raw 256-bit key. */
function cipherPragmas(db: Database.Database, verb: "key" | "rekey") {
  db.pragma("cipher = 'sqlcipher'");
  db.pragma("legacy = 4");
  db.pragma(`${verb} = "x'${derivedKey("database").toString("hex")}'"`);
}

export class MailboxKeyError extends Error {}

/** Open the mailbox file with its key. A wrong key is reported as such, never as damage. */
function openEncrypted(file: string) {
  const db = new Database(file);
  // A new file gets the process umask (often 0644): tighten it before anything is written.
  restrictToOwner(file, 0o600);
  try {
    cipherPragmas(db, "key");
    db.prepare("SELECT count(*) AS c FROM sqlite_master").get();
  } catch (err) {
    db.close();
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (code === "SQLITE_NOTADB") {
      throw new MailboxKeyError(
        "Clarity Mail cannot open its mailbox with the key from the Keychain. Your mail is still on the mail servers.",
      );
    }
    throw err;
  }
  return db;
}

function removeSidecarFiles(file: string) {
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
}

/** Only the owner's account may read the mailbox files. */
function restrictToOwner(target: string, mode: number) {
  for (const candidate of [target, `${target}-wal`, `${target}-shm`]) {
    try {
      if (existsSync(candidate)) chmodSync(candidate, mode);
    } catch {
      // A read-only volume keeps its modes; the database is encrypted anyway.
    }
  }
}

/**
 * Encrypt a mailbox written by an older version. The plain file stays in place
 * until an encrypted copy has been checked, then the copy replaces it.
 */
function encryptPlaintextDatabase(file: string) {
  const plain = new Database(file);
  let count: number;
  try {
    plain.pragma("journal_mode = DELETE");
    count = (plain.prepare("SELECT count(*) AS c FROM sqlite_master").get() as { c: number }).c;
  } finally {
    plain.close();
  }
  removeSidecarFiles(file);
  const temp = `${file}.encrypting`;
  rmSync(temp, { force: true });
  removeSidecarFiles(temp);
  copyFileSync(file, temp);
  try {
    const db = new Database(temp);
    try {
      cipherPragmas(db, "rekey");
    } finally {
      db.close();
    }
    if (isPlaintextDatabase(temp)) throw new Error("The mailbox copy was not encrypted.");
    const check = openEncrypted(temp);
    try {
      const got = (check.prepare("SELECT count(*) AS c FROM sqlite_master").get() as { c: number }).c;
      if (got !== count) throw new Error("The encrypted mailbox copy does not match the original.");
    } finally {
      check.close();
    }
    renameSync(temp, file);
  } catch (err) {
    rmSync(temp, { force: true });
    removeSidecarFiles(temp);
    throw err;
  }
  console.log("[vault] encrypted the mailbox database");
}

/** Repair leftovers from older versions hold readable mail. Delete them once the mailbox is encrypted. */
function removePlaintextCopies(dir: string) {
  for (const name of readdirSync(dir)) {
    if (!/^sorted\.(damaged|recovered-\d+|repair-src-\d+)\.db$/.test(name)) continue;
    const file = path.join(/*turbopackIgnore: true*/ dir, name);
    if (!isPlaintextDatabase(file)) continue;
    rmSync(file, { force: true });
    removeSidecarFiles(file);
  }
}

/** Mailbox passwords sealed with the old key file are sealed again with the Keychain key. */
function migrateAccountSecrets(db: Database.Database) {
  const legacy = legacyKey();
  if (!legacy) return;
  const rows = db.prepare("SELECT id, secret FROM accounts").all() as { id: string; secret: string }[];
  const update = db.prepare("UPDATE accounts SET secret = ? WHERE id = ?");
  db.transaction(() => {
    for (const row of rows) {
      if (canDecryptSecret(row.secret)) continue;
      try {
        update.run(encryptSecret(decryptWith(legacy, row.secret)), row.id);
      } catch {
        // Unreadable with both keys. The mailbox asks for its password again in Settings.
      }
    }
  })();
  rmSync(legacyKeyFile(), { force: true });
  console.log("[vault] moved mailbox passwords to the Keychain key");
}

const SESSIONS_CLEARED = Symbol.for("clarity.sessions-cleared");

/** The Mac app starts locked: sessions from an earlier launch end when its server starts. */
function endSessionsFromLastLaunch(db: Database.Database) {
  const g = globalThis as typeof globalThis & { [SESSIONS_CLEARED]?: boolean };
  if (process.env.CLARITY_DESKTOP !== "1" || g[SESSIONS_CLEARED]) return;
  g[SESSIONS_CLEARED] = true;
  db.prepare("DELETE FROM sessions").run();
}

/** A new SQLite file with the mailbox schema, used when a dump cannot be loaded as-is. */
export function createEmptyDatabase(file: string) {
  rmSync(file, { force: true });
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
  const db = openEncrypted(file);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  db.exec("ALTER TABLE messages ADD COLUMN html TEXT");
  db.exec(`ALTER TABLE messages ADD COLUMN html_rev INTEGER NOT NULL DEFAULT ${HTML_REV}`);
  db.close();
}

/** One repair at a time, including across duplicated server bundles. */
export async function withMailboxLock<T>(fn: () => Promise<T>): Promise<T> {
  const lock = `${dbPath()}.repair.lock`;
  mkdirSync(path.dirname(lock), { recursive: true });
  const start = Date.now();
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        return await fn();
      } finally {
        closeSync(fd);
        unlinkSync(lock);
      }
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > 120_000) throw new Error("Mailbox repair is busy.");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

export function dbPath() {
  return path.join(dataDir(), "sorted.db");
}

export function closeDb() {
  if (!singleton) return;
  singleton.close();
  singleton = null;
}

export function checkpointDb() {
  getDb().pragma("wal_checkpoint(TRUNCATE)");
}

export function getDb() {
  if (singleton) return singleton;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  restrictToOwner(dir, 0o700);
  const file = dbPath();
  if (isPlaintextDatabase(file)) encryptPlaintextDatabase(file);
  // SQLite gives the -wal and -shm files the mode of the main file.
  restrictToOwner(file, 0o600);
  const db = openEncrypted(file);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    db.pragma("secure_delete = ON");
    db.exec(SCHEMA);
    const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    if (!messageColumns.some((column) => column.name === "html")) {
      db.exec("ALTER TABLE messages ADD COLUMN html TEXT");
    }
    if (!messageColumns.some((column) => column.name === "html_rev")) {
      db.exec("ALTER TABLE messages ADD COLUMN html_rev INTEGER NOT NULL DEFAULT 0");
      // Only mail with pictures lost its embedded images: the rest needs no new download.
      db.prepare(`UPDATE messages SET html_rev = ? WHERE html IS NOT NULL AND html NOT LIKE '%<img%'`).run(HTML_REV);
    }
    seedDefaults(db);
    migrateAccountSecrets(db);
    removePlaintextCopies(dir);
    endSessionsFromLastLaunch(db);
  } catch (err) {
    db.close();
    throw err;
  }
  singleton = db;
  return db;
}

export function databaseHealthy() {
  try {
    const db = getDb();
    const rows = db.prepare("PRAGMA quick_check").all() as { quick_check: string }[];
    if (!(rows.length === 1 && rows[0].quick_check === "ok")) return false;
    db.prepare("SELECT COUNT(*) AS c FROM messages").get();
    return true;
  } catch (err) {
    if (isDatabaseDamaged(err)) return false;
    throw err;
  }
}

/** Corrupt pages, or a schema entry that names a table SQLite can no longer open. */
export function isDatabaseDamaged(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code) : "";
  const message = err instanceof Error ? err.message : "";
  return code === "SQLITE_CORRUPT" || /malformed|SQLITE_CORRUPT|no such table/i.test(message);
}

export const MAILBOX_NOTICE =
  "The saved mailbox copy was damaged, and no messages could be read from it. This is a new empty mailbox. Add your accounts again in Settings. Your mail is still on the mail servers.";

export function readMailboxNotice(): string | null {
  try {
    const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get("mailbox_notice") as
      | { value: string }
      | undefined;
    return row?.value || null;
  } catch (err) {
    if (isDatabaseDamaged(err)) return null;
    throw err;
  }
}

export function writeMailboxNotice(notice: string | null) {
  const db = getDb();
  if (!notice) {
    db.prepare("DELETE FROM meta WHERE key = ?").run("mailbox_notice");
    return;
  }
  db.prepare(
    `INSERT INTO meta (key, value) VALUES ('mailbox_notice', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(notice);
}

export function hasUser() {
  const row = getDb().prepare("SELECT id FROM user WHERE id = 1").get();
  return Boolean(row);
}

export function readRevision(): number {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get("revision") as
    | { value: string }
    | undefined;
  return Number(row?.value ?? 0);
}

export function bumpRevision() {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('revision', '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)`,
    )
    .run();
}
