import { route } from "./routing";
import type {
  Account,
  PriorityReason,
  RoutingRule,
  ScoredThread,
  Space,
  Thread,
} from "./types";

const HOUR = 3_600_000;
const DEADLINE_RE =
  /\b(today|tonight|tomorrow|eod|end of (the )?day|deadline|asap|urgent|(by|before) (mon|tues|wednes|thurs|fri|satur|sun)day|(by|before) (the )?\d{1,2}(:\d{2})?\s?(am|pm|h)?|(by|before) (january|february|march|april|may|june|july|august|september|october|november|december) \d{1,2}|due (on|by)|date limite)\b/i;

export const PRIORITY_THRESHOLD = 40;

/** The one or two signals that put a thread on the brief, in words. */
export function whyLine(reasons: PriorityReason[]): string | null {
  const notable = reasons.filter((reason) => Math.abs(reason.points) >= 10);
  if (notable.length === 0) return null;
  return notable
    .slice(0, 2)
    .map((reason) => reason.label)
    .join(" · ");
}

function isInFocusHours(space: Space, now: Date): boolean {
  if (!space.focusHours) return true;
  const { start, end, weekdaysOnly } = space.focusHours;
  const day = now.getDay();
  if (weekdaysOnly && (day === 0 || day === 6)) return false;
  const hour = now.getHours();
  return hour >= start && hour < end;
}

export function scoreThread(
  thread: Thread,
  accounts: Account[],
  spaces: Space[],
  rules: RoutingRule[],
  now: number,
): ScoredThread {
  const account = accounts.find((a) => a.id === thread.accountId) ?? accounts[0];
  const { space: spaceId, category } = route(thread, account, rules);
  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0];
  const last = thread.messages[thread.messages.length - 1];
  const first = thread.messages[0];
  const ownAddresses = [account.email, ...account.aliases].map((a) => a.toLowerCase());
  const lastFromMe = ownAddresses.includes(last.from.email.toLowerCase());
  const ageHours = (now - last.sentAt) / HOUR;

  const reasons: PriorityReason[] = [];
  const add = (label: string, points: number) => reasons.push({ label, points });

  if (space.vips.some((v) => first.from.email.toLowerCase().includes(v.toLowerCase()))) {
    add("VIP sender", 35);
  }
  if (category === "needs-reply" && !lastFromMe) add("Asks for a reply", 25);
  if (DEADLINE_RE.test(`${thread.subject} ${last.body}`) && !lastFromMe) {
    add("Mentions a deadline", 15);
  }
  if (space.slaHours && category === "needs-reply" && !lastFromMe && ageHours > space.slaHours) {
    add(`Past ${space.slaHours}h reply target`, 30);
  } else if (category === "needs-reply" && !lastFromMe && ageHours > 48) {
    add(`Waiting ${Math.floor(ageHours / 24)} days`, 10);
  }
  if (last.to.some((t) => ownAddresses.includes(t.toLowerCase()))) add("Sent directly to you", 5);
  if (thread.starred) add("Starred", 10);
  if (category === "newsletter") add("Newsletter", -40);
  if (category === "notification") add("Automated", -25);
  if (category === "receipt") add("Receipt", -15);
  if (!isInFocusHours(space, new Date(now))) add("Outside focus hours", -20);

  const raw = reasons.reduce((sum, r) => sum + r.points, 0);
  const score = Math.max(0, Math.min(100, raw));

  return {
    ...thread,
    category,
    space: space.id,
    account,
    score,
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    lastActivity: last.sentAt,
  };
}

export function scoreAll(
  threads: Thread[],
  accounts: Account[],
  spaces: Space[],
  rules: RoutingRule[],
  now: number,
): ScoredThread[] {
  return threads.map((t) => scoreThread(t, accounts, spaces, rules, now));
}

export function isLowValue(t: ScoredThread) {
  return t.category === "newsletter" || t.category === "notification";
}
