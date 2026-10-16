import { createHmac, timingSafeEqual } from "node:crypto";
import { encryptionKey, hashPassword, verifyPassword } from "./crypto";
import { getDb, hasUser } from "./db";

const MONTH = 30 * 24 * 60 * 60 * 1000;

export function createUser(password: string) {
  if (hasUser()) throw new Error("Clarity Mail is already set up.");
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  getDb()
    .prepare("INSERT INTO user (id, password_hash, created_at) VALUES (1, ?, ?)")
    .run(hashPassword(password), Date.now());
}

function sign(exp: number) {
  const body = `v1.${exp}`;
  const mac = createHmac("sha256", encryptionKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function startSession(password: string): string | null {
  const row = getDb().prepare("SELECT password_hash FROM user WHERE id = 1").get() as
    | { password_hash: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return sign(Date.now() + MONTH);
}

export function sessionValid(token: string | undefined | null): boolean {
  if (!token) return false;
  const [version, expText, mac] = token.split(".");
  if (version !== "v1" || !expText || !mac) return false;
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createHmac("sha256", encryptionKey()).update(`${version}.${expText}`).digest("base64url");
  const got = Buffer.from(mac);
  const want = Buffer.from(expected);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function endSession(_token: string) {}

export { hasUser };
