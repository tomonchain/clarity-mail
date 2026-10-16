import { NextResponse } from "next/server";
import { hasUser } from "@/server/auth";
import { readMailboxNotice } from "@/server/db";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

export async function GET() {
  try {
    await prepareDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  const hint = process.env.SORTED_DEV_LOGIN_HINT === "1";
  const authenticated = Boolean(await readSession());
  return NextResponse.json({
    needsSetup: !hasUser() && !authenticated,
    authenticated,
    notice: readMailboxNotice(),
    devHint: hint ? process.env.SORTED_DEV_PASSWORD || "sorted-dev" : null,
  });
}
