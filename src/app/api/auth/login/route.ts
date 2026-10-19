import { NextResponse } from "next/server";
import { startSession } from "@/server/auth";
import { clientKey, SESSION_COOKIE, sessionCookie } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

const attempts = new Map<string, { count: number; reset: number }>();
const MAX_FAILURES = 8;
const WINDOW_MS = 10 * 60 * 1000;

function bounce(path: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: path,
      "Cache-Control": "no-store",
    },
  });
}

async function readPassword(request: Request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { password?: string } | null;
    return body?.password ?? "";
  }
  const form = await request.formData().catch(() => null);
  return String(form?.get("password") ?? "");
}

export async function POST(request: Request) {
  const ip = clientKey(request);
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (bucket && bucket.reset > now && bucket.count >= MAX_FAILURES) {
    return bounce("/login?error=rate");
  }
  try {
    await prepareDb();
  } catch (err) {
    console.error("[snapshot]", err instanceof Error ? err.message : err);
    return bounce("/login?error=waking");
  }
  const token = startSession(await readPassword(request));
  if (!token) {
    const current = attempts.get(ip);
    attempts.set(ip, {
      count: current && current.reset > now ? current.count + 1 : 1,
      reset: current && current.reset > now ? current.reset : now + WINDOW_MS,
    });
    // Each wrong guess costs a second, on top of the scrypt work.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return bounce("/login?error=wrong");
  }
  attempts.delete(ip);
  const response = new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/?in=1",
      "Cache-Control": "no-store",
      "Clear-Site-Data": '"cache"',
    },
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookie(request));
  return response;
}
