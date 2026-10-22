import { NextResponse } from "next/server";
import { getDb, readRevision } from "@/server/db";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

/**
 * A cheap "has anything changed?" check, so the app can poll it every few seconds.
 * Sync status rides along: it changes every sync and is not worth a full reload.
 */
export async function GET() {
  try {
    await prepareDb();
  } catch {
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const accounts = (
    getDb().prepare("SELECT id, last_sync_at, sync_error, syncing FROM accounts").all() as {
      id: string;
      last_sync_at: number | null;
      sync_error: string | null;
      syncing: number;
    }[]
  ).map((row) => ({ id: row.id, lastSyncAt: row.last_sync_at, syncError: row.sync_error, syncing: row.syncing === 1 }));
  return NextResponse.json({ revision: readRevision(), accounts });
}
