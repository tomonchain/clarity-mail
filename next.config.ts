import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const desktopBuild = process.env.NEXT_DESKTOP_BUILD === "1";
const dev = process.env.NODE_ENV !== "production";

// Inline scripts are Next.js hydration data and the theme script. Mail HTML is
// rendered in a sandboxed frame without scripts, under its own stricter policy.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "media-src 'none'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "frame-src 'self' about:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self' https://*.agent.cvm.dev",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // "same-origin", not "no-referrer": with no-referrer, Chromium sends `Origin: null` on form
  // posts, which the CSRF check rightly refuses. Other sites still never get a referrer.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  },
];

// Shown in Settings → Updates. The commit is unknown when building without git (Docker).
const APP_VERSION = (JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string }).version;
function appCommit() {
  if (process.env.CLARITY_COMMIT) return process.env.CLARITY_COMMIT;
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION, NEXT_PUBLIC_APP_COMMIT: appCommit() },
  ...(desktopBuild ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
  allowedDevOrigins: ["127.0.0.1", "*.agent.cvm.dev"],
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: SECURITY_HEADERS,
    },
    {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
    {
      source: "/login",
      headers: [
        { key: "Cache-Control", value: "no-store" },
        { key: "Clear-Site-Data", value: '"cache"' },
      ],
    },
    {
      source: "/",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    },
  ],
  serverExternalPackages: ["better-sqlite3-multiple-ciphers", "imapflow", "mailparser", "nodemailer"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
