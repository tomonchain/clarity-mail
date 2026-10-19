import { NextResponse, type NextRequest } from "next/server";

const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

function forbidden(reason: string) {
  return new NextResponse(reason, { status: 403, headers: { "Cache-Control": "no-store" } });
}

// Auth is enforced by the API and AuthGate. A proxy redirect from / to /login
// gets cached by the browser and the Next.js router, so a successful sign-in
// is sent back to the form without the new session cookie ever being checked.
// This proxy only refuses requests that cannot come from Clarity itself.
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  // The Mac app's server answers on 127.0.0.1 only. A web page that points its
  // own domain at 127.0.0.1 (DNS rebinding) still sends its domain as Host.
  if (process.env.CLARITY_DESKTOP === "1" && !LOCAL_HOST.test(host)) {
    return forbidden("Unknown host.");
  }
  // Changes must come from a Clarity page, never from another site's form or script.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        return forbidden("Bad origin.");
      }
      const forwardedHost = request.headers.get("x-forwarded-host") ?? "";
      if (originHost !== host && originHost !== forwardedHost) return forbidden("Cross-site request.");
    } else if (request.headers.get("sec-fetch-site") === "cross-site") {
      return forbidden("Cross-site request.");
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
