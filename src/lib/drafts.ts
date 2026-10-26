import { fullDate } from "./format";
import type { Account, ScoredThread } from "./types";

/** The address of yours this thread was sent to, so a reply or forward goes out from it. */
export function defaultIdentity(thread: ScoredThread): string {
  const identities = [thread.account.email, ...thread.account.aliases];
  for (const m of [...thread.messages].reverse()) {
    const hit = m.to.find((addr) => identities.includes(addr.toLowerCase()));
    if (hit) return hit;
    if (identities.includes(m.from.email.toLowerCase())) return m.from.email;
  }
  return thread.account.email;
}

const FORWARD_MARK = "---------- Forwarded message ----------";

export function forwardDraft(thread: ScoredThread) {
  const last = thread.messages[thread.messages.length - 1];
  const subject = /^fwd?:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`;
  const body = [
    "",
    "",
    FORWARD_MARK,
    `From: ${last.from.name} <${last.from.email}>`,
    `Date: ${fullDate(last.sentAt)}`,
    `Subject: ${thread.subject}`,
    `To: ${last.to.join(", ")}`,
    "",
    last.body,
  ].join("\n");
  return { from: defaultIdentity(thread), subject, body };
}

/** True when one of the thread's messages was sent by you. */
export function sentByMe(thread: ScoredThread) {
  const mine = new Set([thread.account.email, ...thread.account.aliases].map((a) => a.toLowerCase()));
  return thread.messages.some((m) => m.folder === "sent" || mine.has(m.from.email.toLowerCase()));
}
/** The signature of the mailbox an identity belongs to, if any. */
export function signatureFor(accounts: Account[], from: string): string {
  const address = from.toLowerCase();
  const account = accounts.find((a) => a.email.toLowerCase() === address || a.aliases.includes(address));
  return account?.signature?.trim() ?? "";
}

/** The body as sent: the signature under what you wrote, above a forwarded message. */
export function withSignature(body: string, signature: string): string {
  if (!signature) return body;
  const block = `-- \n${signature}`;
  const at = body.indexOf(FORWARD_MARK);
  if (at === -1) return `${body.trimEnd()}\n\n${block}`;
  return `${body.slice(0, at).trimEnd()}\n\n${block}\n\n${body.slice(at)}`;
}
