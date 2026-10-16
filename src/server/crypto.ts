import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export function dataDir() {
  return process.env.SORTED_DATA_DIR || path.join(process.cwd(), "data");
}

let cachedKey: Buffer | null = null;

export function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.SORTED_SECRET?.trim();
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv)) {
      throw new Error("SORTED_SECRET must be 64 hex characters (32 bytes).");
    }
    cachedKey = Buffer.from(fromEnv, "hex");
    return cachedKey;
  }
  mkdirSync(dataDir(), { recursive: true });
  const file = path.join(dataDir(), "secret");
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  const hex = readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`Key file ${file} is not 64 hex characters.`);
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
