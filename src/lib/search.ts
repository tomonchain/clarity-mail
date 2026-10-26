import type { Message, ScoredThread } from "@/lib/types";

// Lower-cased search text per thread, keyed on its messages array, which only changes
// when the mailbox is reloaded.
const haystacks = new WeakMap<Message[], string>();

/** Whether a thread's subject, senders or bodies contain `q`, which must already be trimmed and lower-cased. */
export function matchesSearch(t: ScoredThread, q: string): boolean {
  let text = haystacks.get(t.messages);
  if (text === undefined) {
    text = [t.subject, t.snippet, ...t.messages.map((m) => `${m.from.name} ${m.from.email} ${m.body}`)]
      .join(" ")
      .toLowerCase();
    haystacks.set(t.messages, text);
  }
  return text.includes(q);
}
