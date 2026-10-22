import { NextResponse } from "next/server";
import { devPasswordWorks, hasUser } from "@/server/auth";
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
  // The hint only names the dev password while it really is the password of this mailbox.
  const devPassword = process.env.SORTED_DEV_PASSWORD || "sorted-dev";
  const hint = process.env.SORTED_DEV_LOGIN_HINT === "1" && devPasswordWorks(devPassword);
  const authenticated = Boolean(await readSession());
  return NextResponse.json({
    needsSetup: !hasUser() && !authenticated,
    authenticated,
    notice: readMailboxNotice(),
    devHint: hint ? devPassword : null,
  });
}
