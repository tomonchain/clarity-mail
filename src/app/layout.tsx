import { Suspense, type ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthGate } from "@/components/auth-gate";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clarity Mail",
  description:
    "A personal email aggregator that splits company, project and personal mail into spaces and opens on a prioritized brief.",
  applicationName: "Clarity Mail",
  appleWebApp: {
    capable: true,
    title: "Clarity Mail",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f6f3",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-dvh overflow-hidden">
        <TooltipProvider>
          <Suspense>
            <AuthGate>{children}</AuthGate>
          </Suspense>
        </TooltipProvider>
        <Toaster theme="light" position="bottom-right" />
      </body>
    </html>
  );
}
