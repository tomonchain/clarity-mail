import { get, put } from "@vercel/blob";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { checkpointDb, closeDb, databaseHealthy, dbPath, getDb, hasUser, isDatabaseDamaged, withMailboxLock } from "./db";
import { repairDatabaseFile } from "./repair";

const DB_KEY = "clarity/sorted.db";
const META_KEY = "clarity/meta.json";

let loadedAt = 0;
let remoteHasData = false;
let pins = 0;
let checked = false;
let pendingUpload = false;
let refuseUpload = false;
let tail: Promise<void> = Promise.resolve();

function enabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(async () => {
    try {
      return await fn();
    } finally {
      release();
    }
  });
}

async function readRemoteAt() {
  try {
    const result = await get(META_KEY, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return 0;
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text) as { at?: number };
    const at = Number(parsed.at ?? 0);
    return Number.isFinite(at) ? at : 0;
  } catch (err) {
    if (err instanceof Error && err.name === "BlobNotFoundError") return 0;
    throw err;
  }
}

async function downloadDb(remoteAt: number) {
  const file = await get(DB_KEY, { access: "private", useCache: false });
  if (!file || file.statusCode !== 200 || !file.stream) {
    throw new Error("Database snapshot is missing.");
  }
  const bytes = Buffer.from(await new Response(file.stream).arrayBuffer());
  if (bytes.length < 100) throw new Error("Database snapshot is empty.");
  closeDb();
  const filePath = dbPath();
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  for (const name of ["sorted.db-wal", "sorted.db-shm"]) {
    const side = path.join(/*turbopackIgnore: true*/ dir, name);
    if (existsSync(/*turbopackIgnore: true*/ side)) unlinkSync(/*turbopackIgnore: true*/ side);
  }
  writeFileSync(/*turbopackIgnore: true*/ filePath, bytes);
  loadedAt = remoteAt;
  remoteHasData = true;
}

async function ensureHealthy() {
  const repaired = async () => {
    const result = await repairDatabaseFile();
    getDb();
    checked = true;
    pendingUpload = result.upload;
    refuseUpload = !result.upload;
    return result.upload;
  };
  try {
    getDb();
  } catch (err) {
    if (!isDatabaseDamaged(err)) throw err;
    return repaired();
  }
  if (databaseHealthy()) {
    checked = true;
    refuseUpload = false;
    return false;
  }
  return repaired();
}

async function refreshIfNewer() {
  return withMailboxLock(async () => {
    if (!enabled()) {
      if (!checked) {
        const upload = await ensureHealthy();
        if (upload) await uploadDb(true);
      } else {
        getDb();
      }
      return false;
    }
    const remoteAt = await readRemoteAt();
    if (remoteAt > 0) remoteHasData = true;
    if (remoteAt > loadedAt && pins === 0) {
      await downloadDb(remoteAt);
      checked = false;
    }
    if (!checked && pins === 0) {
      const upload = await ensureHealthy();
      if (upload) await uploadDb(true);
      return false;
    }
    getDb();
    return false;
  });
}

/** Open the shared database, downloading a newer snapshot when one exists. */
export async function prepareDb() {
  const repaired = await exclusive(() => refreshIfNewer());
  if (repaired) await persistDb(true);
}

/**
 * Hold the open database across awaits. A newer snapshot will not replace the
 * file until the hold ends, so in-flight queries keep a live handle.
 */
export async function holdDb<T>(fn: () => Promise<T>) {
  await exclusive(async () => {
    await refreshIfNewer();
    pins += 1;
  });
  try {
    return await fn();
  } finally {
    pins -= 1;
  }
}

async function uploadDb(force = false) {
  if (!enabled()) return;
  if (refuseUpload) {
    console.error("[snapshot] skipping upload; the remote mailbox was not readable");
    return;
  }
  const must = force || pendingUpload;
  getDb();
  if (!hasUser() && !must) return;
  if (remoteHasData && loadedAt === 0 && !must) return;
  if (!databaseHealthy()) {
    console.error("[snapshot] skipping upload of a damaged database");
    return;
  }
  checkpointDb();
  const bytes = readFileSync(dbPath());
  if (bytes.length < 100) return;
  const at = Date.now();
  const options = {
    access: "private" as const,
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    multipart: bytes.length > 4_000_000,
  };
  await put(DB_KEY, bytes, { ...options, contentType: "application/octet-stream" });
  await put(META_KEY, JSON.stringify({ at }), { ...options, contentType: "application/json", multipart: false });
  loadedAt = at;
  remoteHasData = true;
  pendingUpload = false;
}

/** Checkpoint and upload. Skips an empty database so it cannot replace a real one. */
export function persistDb(force = false) {
  return exclusive(() => uploadDb(force));
}

function shutdown() {
  void persistDb()
    .catch((err: unknown) => {
      console.error("[snapshot]", err instanceof Error ? err.message : err);
    })
    .finally(() => process.exit(0));
}

if (
  process.env.NODE_ENV === "production" &&
  enabled() &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
