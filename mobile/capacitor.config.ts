import type { CapacitorConfig } from "@capacitor/cli";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The phone has no Node.js, so the mail stays on your Clarity server (VPS or Vercel)
 * and the app opens it, like the home-screen app does. Set the address in
 * mobile/.env (CLARITY_SERVER_URL=https://clarity.example.com) and run `npm run sync`.
 */
function serverUrl() {
  if (process.env.CLARITY_SERVER_URL) return process.env.CLARITY_SERVER_URL.trim();
  const file = path.join(__dirname, ".env");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("CLARITY_SERVER_URL="));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : "";
}

const url = serverUrl().replace(/\/+$/, "");
if (url && !/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.)/.test(url)) {
  throw new Error("CLARITY_SERVER_URL must use https:// (plain http only for a server on your own network).");
}

const config: CapacitorConfig = {
  appId: "xyz.hedgen.clarity",
  appName: "Clarity Mail",
  // Shown only when no server address is set: explains how to set one.
  webDir: "www",
  server: url
    ? {
        url,
        // Plain http is allowed only for a dev server on your own network.
        cleartext: url.startsWith("http:"),
        allowNavigation: [new URL(url).host],
      }
    : undefined,
  backgroundColor: "#f4f5f7",
  ios: {
    // The web app already pads for the notch and the home indicator (safe-area insets).
    contentInset: "never",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#f4f5f7",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
};

export default config;
