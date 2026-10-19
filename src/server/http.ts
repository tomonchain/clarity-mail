import { cookies } from "next/headers";
import { sessionValid } from "./auth";

export const SESSION_COOKIE = "sorted_session";
const MONTH = 30 * 24 * 60 * 60;

/** The Mac app sets CLARITY_DESKTOP=1 for its local server. */
export function isDesktop() {
  return process.env.CLARITY_DESKTOP === "1";
}

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
  // In the Mac app the session ends when the app quits, so every launch starts locked.
  const desktopSession = isDesktop() && maxAge > 0;
  return {
    httpOnly: true,
    path: "/",
    ...(desktopSession ? {} : { maxAge }),
    secure,
    sameSite: isDesktop() ? ("strict" as const) : ("lax" as const),
  };
}

export async function readToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

export async function readSession(): Promise<string | null> {
  const token = await readToken();
  if (!sessionValid(token)) return null;
  return token;
}

/** The first address in X-Forwarded-For, only where a trusted proxy sets it. */
export function clientKey(request: Request) {
  if (process.env.VERCEL !== "1" && process.env.SORTED_TRUST_PROXY !== "1") return "local";
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
