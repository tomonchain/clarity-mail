import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export function dataDir() {
  return process.env.SORTED_DATA_DIR || path.join(process.cwd(), "data");
}

/** Where the master key came from. */
export type KeySource = "keychain" | "env" | "file";

type Vault = { key: Buffer; source: KeySource; unlock: string | null };

// Next.js can load this module more than once in one process, and stdin can only be read once.
const SLOT = Symbol.for("clarity.vault");
type VaultGlobal = typeof globalThis & { [SLOT]?: Vault };

function hexKey(text: string, from: string): Buffer {
  const hex = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`${from} must be 64 hex characters (32 bytes).`);
  return Buffer.from(hex, "hex");
}

/**
 * The Mac app keeps the master key in the macOS Keychain and writes it to the
 * server's stdin at launch, so it never sits on disk or in the environment.
 */
function readLaunchSecrets(): { key?: string; unlock?: string } | null {
  if (process.env.CLARITY_KEY_STDIN !== "1") return null;
  const text = readFileSync(0, "utf8");
  try {
    return JSON.parse(text) as { key?: string; unlock?: string };
  } catch {
    throw new Error("The desktop app passed an unreadable key.");
  }
}

export function legacyKeyFile() {
  return path.join(dataDir(), "secret");
}

function readKeyFile(file: string): Buffer {
  return hexKey(readFileSync(file, "utf8"), `Key file ${file}`);
}

function loadVault(): Vault {
  const launch = readLaunchSecrets();
  if (launch) {
    if (!launch.key) throw new Error("The desktop app did not pass the mailbox key.");
    return { key: hexKey(launch.key, "The desktop key"), source: "keychain", unlock: launch.unlock || null };
  }
  const fromEnv = process.env.SORTED_SECRET?.trim();
  if (fromEnv) return { key: hexKey(fromEnv, "SORTED_SECRET"), source: "env", unlock: null };
  mkdirSync(dataDir(), { recursive: true });
  const file = legacyKeyFile();
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  return { key: readKeyFile(file), source: "file", unlock: null };
}

function vault(): Vault {
  const g = globalThis as VaultGlobal;
  if (!g[SLOT]) g[SLOT] = loadVault();
  return g[SLOT];
}

/** The master key. It encrypts mailbox passwords and derives the database key. */
export function encryptionKey(): Buffer {
  return vault().key;
}

export function keySource(): KeySource {
  return vault().source;
}

/** A per-launch secret the Mac app uses to open a session after Touch ID. */
export function unlockSecret(): string | null {
  return vault().unlock;
}

/** A separate key for each use, so the master key itself never reaches SQLite. */
export function derivedKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", encryptionKey(), Buffer.alloc(0), `clarity/${purpose}`, 32));
}

/**
 * Older versions kept the master key in a file next to the mailbox. When the
 * Mac app now supplies the key from the Keychain, that file only matters to
 * re-encrypt what it protected, and is then deleted.
 */
export function legacyKey(): Buffer | null {
  if (keySource() === "file") return null;
  const file = legacyKeyFile();
  if (!existsSync(file)) return null;
  try {
    const key = readKeyFile(file);
    return key.equals(encryptionKey()) ? null : key;
  } catch {
    return null;
  }
}

function encryptWith(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptWith(key: Buffer, payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function encryptSecret(plain: string): string {
  return encryptWith(encryptionKey(), plain);
}

export function decryptSecret(payload: string): string {
  return decryptWith(encryptionKey(), payload);
}

export function canDecryptSecret(payload: string): boolean {
  try {
    decryptSecret(payload);
    return true;
  } catch {
    return false;
  }
}

const SCRYPT = { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

/** scrypt with N=2^17. Hashes from older versions (N=2^14, no prefix) still verify. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32, SCRYPT).toString("hex");
  return `s2:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  const strong = parts[0] === "s2";
  const [salt, hash] = strong ? parts.slice(1) : parts;
  if (!salt || !hash) return false;
  const got = strong ? scryptSync(password, salt, 32, SCRYPT) : scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** True when a stored hash uses the older, weaker scrypt cost. */
export function passwordNeedsRehash(stored: string) {
  return !stored.startsWith("s2:");
}

export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
