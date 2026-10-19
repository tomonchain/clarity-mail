import { getDb } from "@/server/db";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

const TYPES = new Set(["image/png", "image/gif", "image/jpeg", "image/webp"]);

/** A picture embedded in a mail (cid:), stored with the message in the encrypted mailbox. */
export async function GET(_request: Request, context: { params: Promise<{ id: string; idx: string }> }) {
  try {
    await prepareDb();
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!(await readSession())) return new Response(null, { status: 401 });
  const { id, idx } = await context.params;
  const index = Number(idx);
  if (!/^[\w-]{1,64}$/.test(id) || !Number.isInteger(index) || index < 0) return new Response(null, { status: 404 });
  const row = getDb()
    .prepare("SELECT mime, data FROM inline_images WHERE message_id = ? AND idx = ?")
    .get(id, index) as { mime: string; data: Buffer } | undefined;
  if (!row || !TYPES.has(row.mime)) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Length": String(row.data.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
