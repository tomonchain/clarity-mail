"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpaceDot } from "@/components/space-badge";
import { PROVIDER_PRESETS } from "@/lib/providers";
import { useStore } from "@/lib/store";
import type { Provider } from "@/lib/types";

const ORDER: Provider[] = ["icloud", "ovh-mxplan", "imap"];

export function AddAccountForm() {
  const { spaces, addAccount, testAccount } = useStore();
  const [provider, setProvider] = useState<Provider>("icloud");
  const [label, setLabel] = useState("iCloud");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [space, setSpace] = useState(spaces.find((s) => s.id === "personal")?.id ?? spaces[0]?.id ?? "");
  const [imapHost, setImapHost] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const preset = PROVIDER_PRESETS[provider];

  const payload = {
    provider,
    label,
    email,
    password,
    defaultSpace: space,
    imapHost: provider === "imap" ? imapHost : undefined,
    smtpHost: provider === "imap" ? smtpHost : undefined,
  };

  const ready = label.trim() && email.trim() && password && space && (provider !== "imap" || (imapHost && smtpHost));

  return (
    <form
      className="space-y-3 rounded-xl border border-dashed p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy("save");
        try {
          await addAccount(payload);
          toast.success(`${label} connected. Mail is syncing.`);
          setPassword("");
          setEmail("");
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not add the account.");
        } finally {
          setBusy(null);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <Select
            value={provider}
            onValueChange={(value) => {
              if (!value) return;
              const next = value as Provider;
              setProvider(next);
              if (next !== "imap") setLabel(PROVIDER_PRESETS[next].label);
            }}
            items={Object.fromEntries(ORDER.map((id) => [id, PROVIDER_PRESETS[id].label]))}
          >
            <SelectTrigger className="w-full" aria-label="Provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORDER.map((id) => (
                <SelectItem key={id} value={id}>
                  {PROVIDER_PRESETS[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-label">Label</Label>
          <Input id="account-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-email">Email</Label>
          <Input
            id="account-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={provider === "icloud" ? "you@icloud.com" : "you@your-domain.fr"}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-password">Password</Label>
          <Input
            id="account-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {provider === "imap" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="imap-host">IMAP host</Label>
              <Input id="imap-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
          </>
        )}
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Default space</Label>
          <Select
            value={space}
            onValueChange={(value) => value && setSpace(value)}
            items={Object.fromEntries(spaces.map((s) => [s.id, s.name]))}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Default space">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <SpaceDot space={s} />
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {preset.help}{" "}
        {provider !== "imap" && (
          <span className="font-mono">
            IMAP {preset.imapHost}:{preset.imapPort} · SMTP {preset.smtpHost}:{preset.smtpPort}
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ready || busy !== null}>
          {busy === "save" ? "Connecting…" : "Add account"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!ready || busy !== null}
          onClick={async () => {
            setBusy("test");
            try {
              await testAccount(payload);
              toast.success("Signed in. The mailbox is reachable.");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not connect.");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "test" ? "Testing…" : "Test connection"}
        </Button>
      </div>
    </form>
  );
}
