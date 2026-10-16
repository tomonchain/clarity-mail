"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <main className="grid h-dvh place-items-center overflow-y-auto px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">Clarity Mail</p>
          <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{lede}</p>
        </div>
        {children}
      </div>
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
      {notice && <p className="text-sm leading-relaxed text-muted-foreground">{notice}</p>}
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
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Saving…" : "Create and continue"}
        </Button>
      </form>
    </Card>
  );
}

export function LoginForm({ error }: { error?: string | null }) {
  const [devHint, setDevHint] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/status")
      .then((res) => res.json())
      .then((body: { devHint?: string | null }) => setDevHint(body.devHint ?? null))
      .catch(() => undefined);
  }, []);

  return (
    <Card title="Sign in" lede="Every inbox, one brief.">
      <form className="space-y-4" method="post" action="/api/auth/login">
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
        {devHint && (
          <p className="text-xs text-muted-foreground">
            This dev server&apos;s password is <code className="font-mono">{devHint}</code>. Mail comes from a local
            test mailbox until you add iCloud or OVH.
          </p>
        )}
      </form>
    </Card>
  );
}
