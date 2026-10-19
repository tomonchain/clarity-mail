"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { LogoMark } from "@/components/brand";
import { StoreProvider } from "@/lib/store";

type Status = { needsSetup: boolean; authenticated: boolean; path: string };

function Splash() {
  return (
    <div className="grid h-dvh place-items-center bg-surface">
      <div className="flex flex-col items-center gap-4">
        <LogoMark className="size-12 animate-pulse rounded-2xl" />
        <p className="text-sm text-muted-foreground">Opening your mail…</p>
      </div>
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<Status | null>(null);
  const known = useRef<Status | null>(null);

  useEffect(() => {
    let cancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (tryIndex: number) => {
      fetch("/api/auth/status", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          return (await res.json()) as Omit<Status, "path">;
        })
        .then((body) => {
          if (cancel) return;
          const next = { ...body, path: pathname };
          known.current = next;
          setStatus(next);
        })
        .catch(() => {
          if (cancel) return;
          const nextTry = tryIndex + 1;
          if (nextTry >= 4 && known.current?.authenticated) return;
          const delay = Math.min(3000, 400 * nextTry);
          timer = setTimeout(() => attempt(nextTry), delay);
        });
    };

    attempt(0);
    return () => {
      cancel = true;
      if (timer) clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!status || status.path !== pathname) return;
    const go = (path: string) => {
      const here = `${window.location.pathname}${window.location.search}`;
      if (here === path) return;
      window.location.replace(`${window.location.origin}${path}`);
    };
    if (status.needsSetup && pathname !== "/setup") go("/setup");
    else if (!status.needsSetup && pathname === "/setup") go("/login");
    else if (!status.authenticated && pathname !== "/login" && pathname !== "/setup") go("/login");
    else if (status.authenticated && (pathname === "/login" || pathname === "/setup")) go("/?in=1");
  }, [status, pathname]);

  if (!status || status.path !== pathname) {
    if (pathname === "/login" || pathname === "/setup") return children;
    if (status?.authenticated && !status.needsSetup) return <Shell>{children}</Shell>;
    return <Splash />;
  }
  if (status.needsSetup) return pathname === "/setup" ? children : <Splash />;
  if (!status.authenticated) return pathname === "/login" ? children : <Splash />;
  if (pathname === "/login" || pathname === "/setup") return <Splash />;
  return <Shell>{children}</Shell>;
}
