"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FingerprintPattern } from "lucide-react";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { greeting } from "@/lib/format";
import { firstName, lockPhoto, usePersonal } from "@/lib/personal";
import { cn } from "@/lib/utils";

function Card({
  title,
  lede,
  children,
}: {
  title: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative grid h-dvh place-items-center overflow-y-auto bg-surface px-4 py-10">
      <div className="desktop-drag absolute inset-x-0 top-0 h-10" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--brand-soft),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <LogoMark className="size-14 rounded-2xl" />
          <div className="space-y-2">
            <h1 className="font-display text-4xl tracking-tight">{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{lede}</p>
          </div>
        </div>
        <div className="rounded-2xl bg-card p-6 shadow-float">{children}</div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Clarity Mail · iCloud, Gmail and any IMAP mailbox in one place
        </p>
      </div>
    </main>
  );
}

// The clock on the lock screen: one value per minute, nothing before hydration.
function subscribeMinute(cb: () => void) {
  const timer = setInterval(cb, 5_000);
  return () => clearInterval(timer);
}
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Full-screen photo, clock and greeting around the unlock form, like a phone's lock screen. */
function LockScreen({ lede, children }: { lede: string; children: React.ReactNode }) {
  const personal = usePersonal();
  const now = useSyncExternalStore(subscribeMinute, minute, () => 0);
  const photo = now ? lockPhoto(personal, now) : null;
  const name = firstName(personal.name);
  const time = now ? new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
  const date = now ? new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <main
      className={cn(
        "relative grid h-dvh place-items-center overflow-y-auto px-4 py-10",
        photo ? "dark bg-neutral-950 text-white" : "bg-surface",
      )}
    >
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote or data: photo, no optimizer wanted */}
          <img
            key={photo.url}
            src={photo.url}
            alt=""
            aria-hidden
            // Fades in once loaded instead of painting line by line.
            onLoad={(event) => event.currentTarget.setAttribute("data-loaded", "")}
            className="pointer-events-none absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-700 data-loaded:opacity-100"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0_0_0/45%),oklch(0_0_0/10%)_40%,oklch(0_0_0/55%))]"
          />
        </>
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,var(--brand-soft),transparent_70%)]"
        />
      )}
      <div className="desktop-drag absolute inset-x-0 top-0 h-10" />
      <div className="relative flex w-full max-w-sm animate-fade-up flex-col items-center">
        <div className={cn("mb-8 flex flex-col items-center text-center", photo && "drop-shadow-[0_2px_12px_oklch(0_0_0/35%)]")}>
          {personal.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL kept on this device
            <img
              src={personal.photo}
              alt=""
              className={cn("mb-5 size-16 rounded-full object-cover shadow-lg", photo ? "ring-2 ring-white/50" : "ring-1 ring-hairline")}
            />
          ) : (
            !photo && <LogoMark className="mb-5 size-14 rounded-2xl" />
          )}
          {time && (
            <>
              <p className={cn("text-sm font-medium capitalize", photo ? "text-white/85" : "text-muted-foreground")}>
                {date}
              </p>
              <p className="font-display text-7xl leading-none tracking-tight tabular-nums sm:text-8xl">{time}</p>
            </>
          )}
          <h1 className={cn("mt-5 font-display tracking-tight", time ? "text-2xl" : "text-4xl")}>
            {now ? `${greeting(now)}${name ? `, ${name}` : ""}` : "Welcome back"}
          </h1>
          <p className={cn("mt-1.5 text-sm leading-relaxed", photo ? "text-white/80" : "text-muted-foreground")}>{lede}</p>
        </div>
        <div
          className={cn(
            "w-full rounded-2xl p-6",
            photo
              ? "bg-black/30 shadow-2xl ring-1 ring-white/15 backdrop-blur-2xl backdrop-saturate-150"
              : "bg-card shadow-float",
          )}
        >
          {children}
        </div>
      </div>
      <p
        className={cn(
          "absolute inset-x-4 bottom-3 flex justify-between gap-4 text-[11px]",
          photo ? "text-white/60" : "text-muted-foreground",
        )}
      >
        <span>Clarity Mail</span>
        {photo?.author && <span className="truncate">Photo: {photo.author} · Unsplash</span>}
      </p>
    </main>
  );
}

function continueHome() {
  window.location.replace(`${window.location.origin}/?in=1`);
}

export function SetupForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/auth/status", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { notice?: string | null } | null) => {
        if (body?.notice) setNotice(body.notice);
      })
      .catch(() => undefined);
  }, []);

  return (
    <Card
      title="Set a password"
      lede="This unlocks Clarity Mail on this server. It is separate from your email passwords, which are stored encrypted."
    >
      {notice && <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{notice}</p>}
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          if (password.length < 8) {
            setError("Use at least 8 characters.");
            return;
          }
          if (password !== confirm) {
            setError("Those passwords don't match.");
            return;
          }
          setBusy(true);
          const res = await fetch("/api/auth/setup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          if (!res.ok) {
            setError(body.error || "Could not set up.");
            return;
          }
          continueHome();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            className="h-10"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm</Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            className="h-10"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant="brand" className="h-10 w-full" disabled={busy}>
          {busy ? "Saving…" : "Create and continue"}
        </Button>
      </form>
    </Card>
  );
}

export function LoginForm({ error, locked = false }: { error?: string | null; locked?: boolean }) {
  const [devHint, setDevHint] = useState<string | null>(null);
  const [touchId, setTouchId] = useState(false);
  const [touchBusy, setTouchBusy] = useState(false);
  const [touchError, setTouchError] = useState<string | null>(null);
  const prompted = useRef(false);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((res) => res.json())
      .then((body: { devHint?: string | null }) => setDevHint(body.devHint ?? null))
      .catch(() => undefined);
  }, []);

  const unlock = useCallback(async () => {
    const desktop = window.clarityDesktop;
    if (!desktop) return;
    setTouchBusy(true);
    setTouchError(null);
    const result = await desktop.unlockWithTouchId().catch(() => ({ ok: false, error: "Touch ID failed." }));
    if (result.ok) {
      window.location.replace(`${window.location.origin}/?in=1`);
      return;
    }
    setTouchBusy(false);
    setTouchError(result.error || "Touch ID did not unlock Clarity.");
  }, []);

  // In the Mac app, offer Touch ID and ask once by itself when the window is in front.
  useEffect(() => {
    const desktop = window.clarityDesktop;
    if (!desktop) return;
    let cancelled = false;
    const promptOnce = () => {
      if (cancelled || prompted.current || error) return;
      prompted.current = true;
      void unlock();
    };
    void desktop
      .getPrefs()
      .then((prefs) => {
        if (cancelled || !prefs?.touchId) return;
        setTouchId(true);
        if (document.hasFocus()) promptOnce();
        else window.addEventListener("focus", promptOnce, { once: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", promptOnce);
    };
  }, [error, unlock]);

  return (
    <LockScreen lede={locked ? "Clarity is locked. Your mail stays encrypted until you unlock." : "Every inbox, one brief."}>
      {touchId && (
        <div className="mb-5 space-y-3">
          <Button
            type="button"
            variant="brand"
            className="h-10 w-full"
            disabled={touchBusy}
            onClick={() => void unlock()}
          >
            <FingerprintPattern />
            {touchBusy ? "Waiting for Touch ID…" : "Unlock with Touch ID"}
          </Button>
          {touchError && <p className="text-sm text-destructive">{touchError}</p>}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or use your password
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>
      )}
      <form className="space-y-4" method="post" action="/api/auth/login">
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus={!touchId}
            className="h-10"
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" variant={touchId ? "outline" : "brand"} className="h-10 w-full">
          {locked ? "Unlock" : "Sign in"}
        </Button>
        {devHint && (
          <p className="text-xs text-muted-foreground">
            This dev server&apos;s password is <code className="font-mono">{devHint}</code>. Mail comes from a local
            test mailbox until you add iCloud or OVH.
          </p>
        )}
      </form>
    </LockScreen>
  );
}
