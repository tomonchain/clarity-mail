import { spawn } from "node:child_process";
import { copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Transform } from "node:stream";
import { closeDb, createEmptyDatabase, dbPath, getDb, MAILBOX_NOTICE, writeMailboxNotice } from "./db";

/** A damaged btree can emit the same row twice. Keep the first copy. */
class IgnoreDuplicateInserts extends Transform {
  private tail = "";

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: string) => void) {
    const text = this.tail + chunk.toString("utf8");
    const hold = 24;
    const safe = text.slice(0, Math.max(0, text.length - hold));
    this.tail = text.slice(safe.length);
    callback(null, safe.replaceAll("\nINSERT INTO ", "\nINSERT OR IGNORE INTO "));
  }

  _flush(callback: (error?: Error | null, data?: string) => void) {
    callback(null, this.tail.replaceAll("\nINSERT INTO ", "\nINSERT OR IGNORE INTO "));
  }
}

function runSqlite(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "ENOENT"
          ? new Error("sqlite3 is not installed, so the mailbox copy cannot be repaired.")
          : error,
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(err).toString().trim() || `sqlite3 exited ${code}`));
        return;
      }
      resolve(Buffer.concat(out).toString());
    });
  });
}

function captureDump(file: string) {
  return new Promise<string>((resolve, reject) => {
    const dump = spawn("sqlite3", [file, ".dump"], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    dump.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    dump.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    dump.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error("sqlite3 is not installed, so the mailbox copy cannot be repaired.") : error);
    });
    dump.on("close", (code) => {
      const sql = Buffer.concat(out).toString("utf8");
      if (!sql.trim() && code !== 0) {
        reject(new Error(Buffer.concat(err).toString().trim() || `sqlite3 .dump failed`));
        return;
      }
      resolve(sql);
    });
  });
}

function loadSql(recovered: string, sql: string, replace = true) {
  return new Promise<void>((resolve, reject) => {
    if (replace) rmSync(recovered, { force: true });
    const load = spawn("sqlite3", [recovered], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    load.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    load.on("error", reject);
    load.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(errors).toString().trim() || `sqlite3 load failed`));
        return;
      }
      resolve();
    });
    load.stdin.end(sql);
  });
}

/** Keep row statements from a dump that rolled back or could not create its own tables. */
function insertStatements(sql: string) {
  return sql
    .split("\n")
    .filter((line) => line.startsWith("INSERT INTO "))
    .map((line) => line.replace("INSERT INTO ", "INSERT OR IGNORE INTO "))
    .join("\n");
}

function rebuildFrom(file: string, recovered: string, command: ".recover" | ".dump") {
  return new Promise<void>((resolve, reject) => {
    rmSync(recovered, { force: true });
    const dump = spawn("sqlite3", [file, command], { stdio: ["ignore", "pipe", "pipe"] });
    const load = spawn("sqlite3", [recovered], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    dump.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    load.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    const sql = command === ".dump" ? dump.stdout.pipe(new IgnoreDuplicateInserts()) : dump.stdout;
    sql.pipe(load.stdin);
    let dumpCode: number | null = null;
    let loadCode: number | null = null;
    const finish = () => {
      if (dumpCode === null || loadCode === null) return;
      if (dumpCode !== 0 || loadCode !== 0) {
        reject(new Error(Buffer.concat(errors).toString().trim() || `sqlite3 ${command} failed`));
        return;
      }
      resolve();
    };
    dump.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new Error("sqlite3 is not installed, so the mailbox copy cannot be repaired.") : error);
    });
    load.on("error", reject);
    dump.on("close", (code) => {
      dumpCode = code ?? 1;
      finish();
    });
    load.on("close", (code) => {
      loadCode = code ?? 1;
      finish();
    });
  });
}

const COUNT_SQL = `SELECT
  CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages') THEN (SELECT count(*) FROM messages) ELSE 0 END,
  CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='user') THEN (SELECT count(*) FROM user) ELSE 0 END,
  CASE WHEN EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts') THEN (SELECT count(*) FROM accounts) ELSE 0 END;`;

export type RepairResult = {
  messages: number;
  users: number;
  accounts: number;
  /** True when this file is safe to store as the remote snapshot. */
  upload: boolean;
};

type Salvage = {
  recovered: string;
  messages: number;
  users: number;
  accounts: number;
  score: number;
};

function copyDatabase(from: string, to: string) {
  rmSync(to, { force: true });
  rmSync(`${to}-wal`, { force: true });
  rmSync(`${to}-shm`, { force: true });
  copyFileSync(from, to);
  if (existsSync(`${from}-wal`)) copyFileSync(`${from}-wal`, `${to}-wal`);
  if (existsSync(`${from}-shm`)) copyFileSync(`${from}-shm`, `${to}-shm`);
}

async function countExisting(file: string) {
  if (!existsSync(file)) return null;
  try {
    const counts = (await runSqlite([file, COUNT_SQL])).trim().split("|");
    const messages = Number(counts[0] ?? 0);
    const users = Number(counts[1] ?? 0);
    const accounts = Number(counts[2] ?? 0);
    if (![messages, users, accounts].every((n) => Number.isFinite(n))) return null;
    return { messages, users, accounts };
  } catch {
    return null;
  }
}

function removeSidecars(file: string) {
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
}

async function salvageFile(file: string, slot: number): Promise<Salvage> {
  const dir = path.dirname(file);
  const source = path.join(/*turbopackIgnore: true*/ dir, `sorted.repair-src-${slot}.db`);
  const recovered = path.join(/*turbopackIgnore: true*/ dir, `sorted.recovered-${slot}.db`);
  copyDatabase(file, source);
  try {
    let dumpSql = "";
    try {
      await rebuildFrom(source, recovered, ".recover");
    } catch (err) {
      console.error("[snapshot]", err instanceof Error ? err.message : err);
      dumpSql = await captureDump(source);
      const inserts = insertStatements(dumpSql);
      console.error(
        `[snapshot] dump ${dumpSql.length} bytes, ${inserts ? inserts.split("\n").filter(Boolean).length : 0} insert lines`,
      );
      try {
        await loadSql(recovered, dumpSql.replaceAll("\nINSERT INTO ", "\nINSERT OR IGNORE INTO "));
      } catch (loadErr) {
        console.error("[snapshot]", loadErr instanceof Error ? loadErr.message : loadErr);
        if (!inserts.trim()) throw loadErr;
        createEmptyDatabase(recovered);
        try {
          await loadSql(recovered, `PRAGMA foreign_keys=OFF;\n${inserts}`, false);
        } catch (insertErr) {
          console.error("[snapshot]", insertErr instanceof Error ? insertErr.message : insertErr);
        }
      }
    }
    let messages = 0;
    let users = 0;
    let accounts = 0;
    try {
      const counts = (await runSqlite([recovered, COUNT_SQL])).trim().split("|");
      messages = Number(counts[0] ?? 0);
      users = Number(counts[1] ?? 0);
      accounts = Number(counts[2] ?? 0);
    } catch (err) {
      console.error("[snapshot]", err instanceof Error ? err.message : err);
    }
    if (messages + users + accounts === 0) {
      if (!dumpSql) {
        try {
          dumpSql = await captureDump(source);
        } catch (err) {
          console.error("[snapshot]", err instanceof Error ? err.message : err);
        }
      }
      const inserts = insertStatements(dumpSql);
      if (inserts.trim()) {
        try {
          createEmptyDatabase(recovered);
          try {
            await loadSql(recovered, `PRAGMA foreign_keys=OFF;\n${inserts}`, false);
          } catch (insertErr) {
            console.error("[snapshot]", insertErr instanceof Error ? insertErr.message : insertErr);
          }
          const counts = (await runSqlite([recovered, COUNT_SQL])).trim().split("|");
          messages = Number(counts[0] ?? 0);
          users = Number(counts[1] ?? 0);
          accounts = Number(counts[2] ?? 0);
        } catch (err) {
          console.error("[snapshot]", err instanceof Error ? err.message : err);
        }
      }
    }
    const check = (await runSqlite([recovered, "PRAGMA integrity_check;"])).trim();
    if (!check.startsWith("ok")) throw new Error("Repaired mailbox still looks damaged.");
    if (![messages, users, accounts].every((n) => Number.isFinite(n))) {
      throw new Error("Could not count rows in the repaired mailbox.");
    }
    return {
      recovered,
      messages,
      users,
      accounts,
      score: messages * 1_000_000 + accounts * 1_000 + users,
    };
  } catch (err) {
    rmSync(recovered, { force: true });
    throw err;
  } finally {
    rmSync(source, { force: true });
    removeSidecars(source);
  }
}

function swapIn(recovered: string) {
  closeDb();
  const file = dbPath();
  const dir = path.dirname(file);
  for (const name of ["sorted.db-wal", "sorted.db-shm"]) rmSync(path.join(/*turbopackIgnore: true*/ dir, name), { force: true });
  const damaged = path.join(/*turbopackIgnore: true*/ dir, "sorted.damaged.db");
  if (existsSync(/*turbopackIgnore: true*/ file) && path.resolve(file) !== path.resolve(recovered)) {
    if (!existsSync(damaged)) renameSync(file, damaged);
    else rmSync(file, { force: true });
  }
  if (path.resolve(recovered) !== path.resolve(file)) renameSync(recovered, file);
}

function openFreshMailbox() {
  closeDb();
  const file = dbPath();
  const dir = path.dirname(file);
  for (const name of ["sorted.db-wal", "sorted.db-shm"]) rmSync(path.join(/*turbopackIgnore: true*/ dir, name), { force: true });
  const damaged = path.join(/*turbopackIgnore: true*/ dir, "sorted.damaged.db");
  if (existsSync(/*turbopackIgnore: true*/ file)) {
    if (!existsSync(damaged)) renameSync(file, damaged);
    else rmSync(file, { force: true });
  }
  getDb();
  writeMailboxNotice(MAILBOX_NOTICE);
}

/**
 * Rebuild the mailbox from the rows that can still be read.
 * A copy with no readable rows is replaced. An unreadable snapshot is replaced
 * too, unless the failure was a lock or a missing sqlite3, so a bad file cannot
 * keep the next boot on the same damaged copy.
 */
export async function repairDatabaseFile(): Promise<RepairResult> {
  closeDb();
  const file = dbPath();
  const damaged = path.join(/*turbopackIgnore: true*/ path.dirname(file), "sorted.damaged.db");
  const files = [file, damaged].filter(
    (candidate, index, all) => existsSync(/*turbopackIgnore: true*/ candidate) && all.indexOf(candidate) === index,
  );

  let best: Salvage | null = null;
  let readable = 0;
  let failures = 0;
  let blocked = false;
  for (const [index, candidate] of files.entries()) {
    try {
      const salvaged = await salvageFile(candidate, index);
      readable += 1;
      const bytes = statSync(candidate).size;
      console.error(
        `[snapshot] read ${candidate} (${bytes} bytes): ${salvaged.messages} messages, ${salvaged.accounts} accounts, ${salvaged.users} passwords`,
      );
      if (!best || salvaged.score > best.score) best = salvaged;
    } catch (err) {
      failures += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (/locked|disk I\/O|unable to open|not installed/i.test(message)) blocked = true;
      console.error("[snapshot]", message);
    }
  }

  const leftovers = [0, 1].flatMap((slot) => {
    const dir = path.dirname(file);
    return [
      path.join(/*turbopackIgnore: true*/ dir, `sorted.recovered-${slot}.db`),
      path.join(/*turbopackIgnore: true*/ dir, `sorted.repair-src-${slot}.db`),
    ];
  });

  const current = await countExisting(file);
  if (current && current.messages > (best?.messages ?? 0)) {
    for (const leftover of leftovers) rmSync(leftover, { force: true });
    getDb();
    writeMailboxNotice(null);
    console.error(`[snapshot] kept the mailbox already on disk (${current.messages} messages)`);
    return { messages: current.messages, users: current.users, accounts: current.accounts, upload: true };
  }

  if (best && best.score > 0) {
    const chosen = best.recovered;
    swapIn(chosen);
    for (const leftover of leftovers) {
      if (path.resolve(leftover) !== path.resolve(dbPath())) rmSync(leftover, { force: true });
    }
    getDb();
    writeMailboxNotice(best.messages === 0 ? MAILBOX_NOTICE : null);
    console.error(
      `[snapshot] repaired a damaged mailbox database (${best.messages} messages, ${best.accounts} accounts, ${best.users} passwords)`,
    );
    return { messages: best.messages, users: best.users, accounts: best.accounts, upload: true };
  }

  for (const leftover of leftovers) rmSync(leftover, { force: true });
  openFreshMailbox();
  const upload = !blocked;
  console.error(
    upload
      ? `[snapshot] mailbox copy had no recoverable rows (${readable} readable, ${failures} failed); opened a fresh mailbox`
      : "[snapshot] mailbox copy could not be read safely; opened a fresh mailbox locally and left the remote snapshot untouched",
  );
  return { messages: 0, users: 0, accounts: 0, upload };
}
