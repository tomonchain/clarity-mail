import type { Account, Category, RoutingRule, SpaceId, Thread } from "./types";

function matches(rule: RoutingRule, thread: Thread): boolean {
  const first = thread.messages[0];
  const value = rule.value.trim().toLowerCase();
  if (!first || !value) return false;

  switch (rule.field) {
    case "to":
      return thread.messages.some((m) =>
        m.to.some((addr) => addr.toLowerCase().includes(value)),
      );
    case "fromDomain":
      return first.from.email.toLowerCase().endsWith(`@${value.replace(/^@/, "")}`);
    case "fromEmail":
      return first.from.email.toLowerCase() === value;
    case "subject":
      return thread.subject.toLowerCase().includes(value);
  }
}

/** First matching rule wins for each of space and category, independently. */
export function route(
  thread: Thread,
  account: Account,
  rules: RoutingRule[],
): { space: SpaceId; category: Category } {
  let space: SpaceId | undefined = thread.spaceOverride;
  let category: Category | undefined;

  for (const rule of rules) {
    if (!matches(rule, thread)) continue;
    if (!space && rule.space) space = rule.space;
    if (!category && rule.category) category = rule.category;
    if (space && category) break;
  }

  return {
    space: space ?? account.defaultSpace,
    category: category ?? thread.category,
  };
}

export function countRuleMatches(rule: RoutingRule, threads: Thread[]): number {
  return threads.filter((t) => matches(rule, t)).length;
}

export const RULE_FIELD_LABELS: Record<RoutingRule["field"], string> = {
  to: "Sent to address",
  fromDomain: "Sender domain",
  fromEmail: "Sender email",
  subject: "Subject contains",
};
