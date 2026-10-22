import { looksLikeHtml } from "@/lib/mail-format";
import { getDb } from "@/server/db";
import { cleanMailHtml } from "@/server/html";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

/** The HTML of one message, sanitized again on the way out, for the reading pane. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await prepareDb();
  } catch {
    return Response.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { id } = await context.params;
  if (!/^[\w-]{1,64}$/.test(id)) return Response.json({ error: "Not found." }, { status: 404 });
  const row = getDb().prepare("SELECT body, html FROM messages WHERE id = ?").get(id) as
    | { body: string; html: string | null }
    | undefined;
  if (!row) return Response.json({ error: "Not found." }, { status: 404 });
  const source = row.html || (looksLikeHtml(row.body) ? row.body : "");
  return Response.json(
    { html: source ? cleanMailHtml(source) : "" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
