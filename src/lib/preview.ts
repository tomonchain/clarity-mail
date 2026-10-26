import type { Message, ScoredThread } from "@/lib/types";

// Where the new text of a reply stops: the quoted mail or the signature below it.
const CUT = [
  /^\s*>/,
  /^\s*(on|le)\s.+(wrote|a écrit)\s*:?\s*$/i,
  /^\s*-{2,}\s*(original message|message d'origine|forwarded message|message transféré)?/i,
  /^\s*_{5,}/,
  /^\s*(from|de|envoyé|sent)\s*:\s/i,
  /^\s*(sent from my|envoyé de mon|get outlook for)/i,
  /^\s*(best( regards)?|kind regards|regards|cheers|thanks|thank you|cordialement|bien à (toi|vous)|bonne (journée|soirée)|à (bientôt|plus)|merci( beaucoup)?)[\s,.!]*$/i,
];
// Openers that say nothing about the content.
const GREETING =
  /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|bonjour|bonsoir|salut|coucou|cher|chère)\b[^.!?\n]{0,40}[,!.:]?\s*$/i;
const LINK = /\bhttps?:\/\/\S+/g;

const summaries = new WeakMap<Message, string>();

/** The opening sentences of what the latest message actually says, minus greeting, quote and signature. */
function gist(message: Message): string {
  const known = summaries.get(message);
  if (known !== undefined) return known;
  const kept: string[] = [];
  for (const line of message.body.split(/\r?\n/)) {
    if (CUT.some((re) => re.test(line))) break;
    if (kept.length === 0 && (GREETING.test(line) || !line.trim())) continue;
    kept.push(line);
  }
  const text = kept.join(" ").replace(LINK, "").replace(/\s+/g, " ").trim();
  let out = "";
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? []) {
    if (out && out.length + sentence.length > 160) break;
    out += sentence;
    if (out.length > 90) break;
  }
  out = out.trim();
  if (out.length > 180) out = `${out.slice(0, 177).trimEnd()}…`;
  summaries.set(message, out);
  return out;
}

/** What a row shows under the subject: the AI summary when there is one, else the gist of the latest message. */
export function previewOf(thread: ScoredThread, mode: "summary" | "text"): { text: string; ai: boolean } {
  if (mode === "text") return { text: thread.snippet, ai: false };
  if (thread.summary && thread.summarySource === "ai") return { text: thread.summary, ai: true };
  const last = thread.messages[thread.messages.length - 1];
  return { text: (last && gist(last)) || thread.snippet, ai: false };
}
