import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { keySource } from "@/server/crypto";
import { dbPath, getDb, isPlaintextDatabase } from "@/server/db";
import { isDesktop, readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

function fileVault(): Promise<"on" | "off" | "unknown"> {
  if (process.platform !== "darwin") return Promise.resolve("unknown");
  return new Promise((resolve) => {
    execFile("/usr/bin/fdesetup", ["isactive"], { timeout: 3000 }, (_err, stdout) => {
      const text = String(stdout ?? "").trim();
      resolve(text === "true" ? "on" : text === "false" ? "off" : "unknown");
    });
  });
}

/** What protects the mailbox on this machine, for Settings → Security. */
export async function GET() {
  try {
    await prepareDb();
  } catch {
    return NextResponse.json({ error: "Mail store is waking up." }, { status: 503 });
  }
  if (!(await readSession())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const sessions = getDb().prepare("SELECT count(*) AS c FROM sessions WHERE expires_at > ?").get(Date.now()) as {
    c: number;
  };
  return NextResponse.json({
    encrypted: !isPlaintextDatabase(dbPath()),
    keySource: keySource(),
    fileVault: await fileVault(),
    sessions: sessions.c,
    desktop: isDesktop(),
  });
}
