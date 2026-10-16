import { NextResponse } from "next/server";

// Auth is enforced by the API and AuthGate. A proxy redirect from / to /login
// gets cached by the browser and the Next.js router, so a successful sign-in
// is sent back to the form without the new session cookie ever being checked.
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico).*)"],
};
