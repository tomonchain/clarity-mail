import { cookies } from "next/headers";
import { sessionValid } from "./auth";

export const SESSION_COOKIE = "sorted_session";
const MONTH = 30 * 24 * 60 * 60;

export function sessionCookie(request: Request, maxAge = MONTH) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const origin = request.headers.get("origin") ?? "";
  const referer = request.headers.get("referer") ?? "";
  const forwardedHost = request.headers.get("x-forwarded-host") ?? "";
  const secure =
    process.env.SORTED_SECURE_COOKIE === "1" ||
    forwarded === "https" ||
    origin.startsWith("https:") ||
    referer.startsWith("https:") ||
    forwardedHost.includes("agent.cvm.dev") ||
    request.url.startsWith("https:");
  const embedded =
    forwardedHost.includes("agent.cvm.dev") || request.headers.get("sec-fetch-dest") === "iframe";
  if (secure && embedded) {
    return {
      httpOnly: true,
      path: "/",
      maxAge,
      secure: true,
      sameSite: "none" as const,
      partitioned: true as const,
    };
  }
  return {
    httpOnly: true,
    path: "/",
    maxAge,
    secure,
    sameSite: "lax" as const,
  };
}

export async function readSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!sessionValid(token)) return null;
  return token ?? null;
}
