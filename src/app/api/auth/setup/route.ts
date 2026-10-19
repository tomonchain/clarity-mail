import { NextResponse } from "next/server";
import { createUser, issueSession } from "@/server/auth";
import { SESSION_COOKIE, sessionCookie } from "@/server/http";
import { persistDb, prepareDb } from "@/server/snapshot";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  try {
    await prepareDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Mail store is waking up. Try again." }, { status: 503 });
  }
  try {
    createUser(body?.password ?? "");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not set up.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  const token = issueSession();
  try {
    await persistDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
  }
  const response = NextResponse.json({ ok: true });
  if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookie(request));
  return response;
}
