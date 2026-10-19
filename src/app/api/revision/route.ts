import { NextResponse } from "next/server";
import { readRevision } from "@/server/db";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

/** A cheap "has anything changed?" check, so the app can poll it every few seconds. */
export async function GET() {
  try {
    await prepareDb();
  } catch {
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  return NextResponse.json({ revision: readRevision() });
}
