import { createHash, randomBytes } from "node:crypto";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./crypto";
import { getDb, hasUser } from "./db";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createUser(password: string) {
  if (hasUser()) throw new Error("Clarity Mail is already set up.");
  checkStrength(password);
  getDb()
    .prepare("INSERT INTO user (id, password_hash, created_at) VALUES (1, ?, ?)")
    .run(hashPassword(password), Date.now());
}

function checkStrength(password: string) {
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  if (password.length > 512) throw new Error("Use at most 512 characters.");
}

/** Sessions are random tokens. Only their hash is stored, so a copy of the mailbox cannot sign anyone in. */
function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSession(): string {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("INSERT INTO sessions (token, expires_at) VALUES (?, ?)").run(digest(token), now + SESSION_TTL_MS);
  return token;
}

function storedHash(): string | null {
  const row = getDb().prepare("SELECT password_hash FROM user WHERE id = 1").get() as
    | { password_hash: string }
    | undefined;
  return row?.password_hash ?? null;
}

export function checkPassword(password: string): boolean {
  const stored = storedHash();
  if (!stored || password.length > 512 || !verifyPassword(password, stored)) return false;
  if (passwordNeedsRehash(stored)) {
    getDb().prepare("UPDATE user SET password_hash = ? WHERE id = 1").run(hashPassword(password));
  }
  return true;
}

// Hashing a password costs about 200 ms, so the answer is kept until the stored hash changes.
let devCheck: { hash: string; password: string; works: boolean } | null = null;

/** Dev only: whether the dev password signs in to this mailbox, for the hint on the sign-in page. */
export function devPasswordWorks(password: string): boolean {
  const stored = storedHash();
  if (!stored) return false;
  if (devCheck?.hash !== stored || devCheck.password !== password) {
    devCheck = { hash: stored, password, works: password.length <= 512 && verifyPassword(password, stored) };
  }
  return devCheck.works;
}

export function startSession(password: string): string | null {
  if (!checkPassword(password)) return null;
  return issueSession();
}

export function sessionValid(token: string | undefined | null): boolean {
  if (!token || token.length > 200) return false;
  const row = getDb().prepare("SELECT expires_at FROM sessions WHERE token = ?").get(digest(token)) as
    | { expires_at: number }
    | undefined;
  return Boolean(row && row.expires_at > Date.now());
}

export function endSession(token: string) {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(digest(token));
}

/** Sign out every window and device, except the session given. */
export function endOtherSessions(keep: string | null) {
  if (keep) getDb().prepare("DELETE FROM sessions WHERE token != ?").run(digest(keep));
  else getDb().prepare("DELETE FROM sessions").run();
}

export function changePassword(current: string, next: string) {
  if (!checkPassword(current)) throw new Error("The current password is wrong.");
  checkStrength(next);
  getDb().prepare("UPDATE user SET password_hash = ? WHERE id = 1").run(hashPassword(next));
}

export { hasUser };
