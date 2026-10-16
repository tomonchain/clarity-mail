import { NextResponse } from "next/server";
import { isDatabaseDamaged } from "@/server/db";
import { readSession } from "@/server/http";
import { repairDatabaseFile } from "@/server/repair";
import { persistDb, prepareDb } from "@/server/snapshot";
import { readState } from "@/server/state";

export async function GET() {
  try {
    await prepareDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  try {
    return NextResponse.json(readState());
  } catch (err) {
    if (!isDatabaseDamaged(err)) throw err;
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    try {
      const result = await repairDatabaseFile();
      if (result.upload) await persistDb(true);
      return NextResponse.json(readState());
    } catch (repairErr) {
      console.error("[snapshot]", repairErr instanceof Error ? repairErr.message : repairErr);
      return NextResponse.json({ error: "The mailbox copy was damaged. Reload in a moment." }, { status: 503 });
    }
  }
}
