import { NextResponse } from "next/server";
import { changePassword, endOtherSessions } from "@/server/auth";
import { readSession } from "@/server/http";
import { persistDb, prepareDb } from "@/server/snapshot";

/** Change the app password and sign out every other session. */
export async function POST(request: Request) {
  try {
    await prepareDb();
  } catch {
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  const token = await readSession();
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  try {
    changePassword(current, next);
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not change it." }, { status: 400 });
  }
  endOtherSessions(token);
  try {
    await persistDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}
