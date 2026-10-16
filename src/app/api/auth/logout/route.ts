import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";
import { SESSION_COOKIE, sessionCookie } from "@/server/http";

export async function POST(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)sorted_session=([^;]+)/)?.[1];
  if (token) endSession(decodeURIComponent(token));
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", sessionCookie(request, 0));
  return response;
}
