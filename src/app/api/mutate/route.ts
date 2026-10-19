import { NextResponse } from "next/server";
import { ApiError, mutate } from "@/server/mutate";
import { readSession } from "@/server/http";
import { persistDb, prepareDb } from "@/server/snapshot";

export async function POST(request: Request) {
  try {
    await prepareDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const op = body && typeof body === "object" && "op" in body ? String(body.op).slice(0, 40) : "?";
  try {
    const result = await mutate(body);
    try {
      await persistDb();
    } catch (err) {
      console.error("[snapshot]", err instanceof Error ? err.message : err);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status >= 500) console.error("[mutate]", op, err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[mutate]", op, err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
