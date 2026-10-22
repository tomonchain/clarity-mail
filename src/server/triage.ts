import type { Category } from "@/lib/types";
import { getDb, type MessageRow, type ThreadRow } from "./db";
import { loadEnvFile } from "./env";
import { messagesForThread } from "./threads";

const CATEGORIES: Category[] = [
  "needs-reply",
  "fyi",
  "calendar",
  "receipt",
  "notification",
  "newsletter",
];

function heuristic(msg: MessageRow): Category {
  if (msg.list_unsub) return "newsletter";
  if (msg.auto_submitted) return "notification";
  if (/no[-_.]?reply|notifications?@|mailer-daemon|noreply/.test(msg.from_email)) return "notification";
  const haystack = `${msg.subject}\n${msg.body}`;
  if (/\b(receipt|invoice|facture|reçu|recu|payment|payout)\b/i.test(haystack)) return "receipt";
  if (/\b(calendar|invitation|meeting invite)\b/i.test(msg.subject)) return "calendar";
  if (/\?|\b(can you|could you|would you|please|merci de|pouvez-vous|let me know|yes\/no|confirm)\b/i.test(haystack)) {
    return "needs-reply";
  }
  return "fyi";
}

type Provider = { name: string; url: string; key: string; model: string };

function provider(): Provider | null {
  loadEnvFile();
  const deepseek = process.env.DEEPSEEK_API_KEY?.trim();
  if (deepseek) {
    return {
      name: "DeepSeek",
      url: "https://api.deepseek.com/chat/completions",
      key: deepseek,
      model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    };
  }
  const mistral = process.env.MISTRAL_API_KEY?.trim();
  if (mistral) {
    return {
      name: "Mistral",
      url: "https://api.mistral.ai/v1/chat/completions",
      key: mistral,
      model: process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest",
    };
  }
  return null;
}

function ownerEmail(accountId: string): string {
  const row = getDb().prepare("SELECT email FROM accounts WHERE id = ?").get(accountId) as
    | { email: string }
    | undefined;
  return row?.email ?? "";
}

function parseModelJson(text: string): { category?: string; summary?: string } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as { category?: string; summary?: string };
}

async function classify(msg: MessageRow, ai: Provider): Promise<{ category: Category; summary: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(ai.url, {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${ai.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: ai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Triage one email. Reply with JSON only: {"category":"needs-reply"|"fyi"|"calendar"|"receipt"|"notification"|"newsletter","summary":"one sentence, max 180 characters"}. Use needs-reply only when someone else asks the mailbox owner to do or answer something. Never use needs-reply when the latest message is from the mailbox owner. In the summary, use the sender\'s name and say "you" for the mailbox owner. Do not write the words "mailbox owner".',
          },
          {
            role: "user",
            content: `Mailbox owner: ${ownerEmail(msg.account_id)}\nFrom: ${msg.from_name} <${msg.from_email}>\nTo: ${msg.to_json}\nSubject: ${msg.subject}\n\n${msg.body.slice(0, 2000)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${ai.name} responded ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = parseModelJson(text);
    if (!CATEGORIES.includes(parsed.category as Category)) return null;
    return {
      category: parsed.category as Category,
      summary: String(parsed.summary ?? "").slice(0, 180),
    };
  } finally {
    clearTimeout(timer);
  }
}

const AI_PER_SYNC = 10;

/** Classify threads waiting for triage. Returns how many were updated. */
export async function triageAccount(accountId: string) {
  const db = getDb();
  const pending = db
    .prepare("SELECT id FROM threads WHERE account_id = ? AND triaged = 0 ORDER BY rowid DESC LIMIT 20")
    .all(accountId) as Pick<ThreadRow, "id">[];
  const ai = provider();
  const owner = ownerEmail(accountId).toLowerCase();
  // The AI calls run side by side: ten in a row could hold a sync for minutes.
  const results = await Promise.all(
    pending.map(async (thread, index) => {
      const msg = messagesForThread(thread.id).at(-1);
      if (!msg) return null;
      let category = heuristic(msg);
      let summary: string | null = null;
      let source: string | null = null;
      if (ai && index < AI_PER_SYNC) {
        try {
          const result = await classify(msg, ai);
          if (result) {
            const own = msg.from_email.toLowerCase() === owner;
            category = result.category;
            if (msg.list_unsub) category = "newsletter";
            else if (
              msg.auto_submitted ||
              /no[-_.]?reply|notifications?@|mailer-daemon|noreply/.test(msg.from_email)
            ) {
              category = "notification";
            } else if (own && category === "needs-reply") category = "fyi";
            summary = result.summary || null;
            source = "ai";
          }
        } catch (err) {
          console.error("[triage]", err instanceof Error ? err.message : err);
        }
      }
      return { id: thread.id, category, summary, source };
    }),
  );
  const update = db.prepare("UPDATE threads SET category = ?, summary = ?, summary_source = ?, triaged = 1 WHERE id = ?");
  let updated = 0;
  db.transaction(() => {
    for (const r of results) if (r) updated += update.run(r.category, r.summary, r.source, r.id).changes;
  })();
  return updated;
}
