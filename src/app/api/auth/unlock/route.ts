import { NextResponse } from "next/server";
import { hasUser, issueSession, SESSION_TTL_MS } from "@/server/auth";
import { sameSecret, unlockSecret } from "@/server/crypto";
import { prepareDb } from "@/server/snapshot";

/**
 * Called by the Mac app itself after Touch ID, never by the page. The secret
 * is generated at each launch and only the app's main process knows it.
 */
export async function POST(request: Request) {
  const secret = unlockSecret();
  const given = request.headers.get("x-clarity-unlock") ?? "";
  if (!secret || !given || !sameSecret(given, secret)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  try {
    await prepareDb();
  } catch {
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!hasUser()) return NextResponse.json({ error: "Set up Clarity Mail first." }, { status: 409 });
  return NextResponse.json(
    { token: issueSession(), expiresAt: Date.now() + SESSION_TTL_MS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
