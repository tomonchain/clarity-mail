import type { NextConfig } from "next";

const desktopBuild = process.env.NEXT_DESKTOP_BUILD === "1";

const nextConfig: NextConfig = {
  ...(desktopBuild ? { output: "standalone" as const, distDir: ".next-desktop" } : {}),
  allowedDevOrigins: ["127.0.0.1", "*.agent.cvm.dev"],
  headers: async () => [
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
  serverExternalPackages: ["better-sqlite3", "imapflow", "mailparser", "nodemailer"],
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
