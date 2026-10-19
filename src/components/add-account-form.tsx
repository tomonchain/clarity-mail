"use client";

import { useRef, useState } from "react";
import { AtSign, ChevronDown, Cloud, ExternalLink, Loader2, Mail, Server } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useStore, type DetectedSettings } from "@/lib/store";
import type { Provider } from "@/lib/types";
import { cn } from "@/lib/utils";

const PROVIDERS: { id: Provider; name: string; icon: typeof Mail; tint: string }[] = [
  { id: "icloud", name: "iCloud", icon: Cloud, tint: "text-sky-500" },
  { id: "gmail", name: "Gmail", icon: Mail, tint: "text-red-500" },
  { id: "ovh-mxplan", name: "OVH MX Plan", icon: Server, tint: "text-blue-600" },
  { id: "imap", name: "Other", icon: AtSign, tint: "text-muted-foreground" },
];

/** Where to get the password each provider wants. */
const PASSWORD_LINKS: Partial<Record<Provider, { href: string; label: string }>> = {
  icloud: { href: "https://account.apple.com/account/manage", label: "Create an app-specific password" },
  gmail: { href: "https://myaccount.google.com/apppasswords", label: "Create an app password" },
  "ovh-mxplan": { href: "https://www.ovh.com/manager/#/web", label: "Open the OVH control panel" },
};

const SOURCE_NOTE: Record<DetectedSettings["source"], string> = {
  domain: "from the address",
  mx: "from the domain's MX records",
  autoconfig: "from Thunderbird's public server list",
  guess: "as a guess, check the servers",
};

/** 993 and 465 mean TLS from the first byte; any other port upgrades with STARTTLS. */
const imapSecureFor = (port: number) => port === 993;
const smtpSecureFor = (port: number) => port === 465;

export function AddAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="gap-1 px-6 pt-6 pb-4">
          <DialogTitle className="text-lg font-semibold tracking-tight">Add a mailbox</DialogTitle>
          <DialogDescription>
            iCloud, Gmail, OVH MX Plan or any address with IMAP. The password is stored encrypted on this Mac.
          </DialogDescription>
        </DialogHeader>
        <AddAccountForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddAccountForm({ onDone }: { onDone: () => void }) {
  const { spaces, addAccount, testAccount, detectAccount } = useStore();
  const [provider, setProvider] = useState<Provider>("icloud");
  const [label, setLabel] = useState("iCloud");
  const [labelTouched, setLabelTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [space, setSpace] = useState(spaces.find((s) => s.id === "personal")?.id ?? spaces[0]?.id ?? "");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState(993);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState(587);
  const [showServers, setShowServers] = useState(false);
  const [detected, setDetected] = useState<(DetectedSettings & { email: string }) | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const latestEmail = useRef("");
  const serversTouched = useRef(false);
  const [manualServers, setManualServers] = useState(false);
  const preset = PROVIDER_PRESETS[provider];
  const custom = provider === "imap";
  const link = PASSWORD_LINKS[provider];

  const payload = {
    provider,
    label,
    email,
    password,
    defaultSpace: space,
    ...(custom
      ? {
          imapHost,
          imapPort,
          imapSecure: imapSecureFor(imapPort),
          smtpHost,
          smtpPort,
          smtpSecure: smtpSecureFor(smtpPort),
        }
      : {}),
  };

  const ready =
    label.trim() && email.trim() && password && space && (!custom || (imapHost && smtpHost && imapPort && smtpPort));

  const choose = (next: Provider, nextLabel?: string) => {
    setProvider(next);
    if (!labelTouched) setLabel(nextLabel ?? (next === "imap" ? label : PROVIDER_PRESETS[next].label));
  };

  const detect = async () => {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address) || detected?.email === address) return;
    setDetecting(true);
    try {
      const found = await detectAccount(address);
      // The lookup can take seconds: drop it if the address changed or servers were typed meanwhile.
      if (latestEmail.current !== address) return;
      setDetected({ ...found, email: address });
      if (serversTouched.current) return;
      setImapHost(found.imapHost);
      setImapPort(found.imapPort);
      setSmtpHost(found.smtpHost);
      setSmtpPort(found.smtpPort);
      choose(found.provider, found.label);
    } catch {
      // Detection is a convenience; the user can still pick a provider by hand.
    } finally {
      setDetecting(false);
    }
  };

  /** Typing a server by hand wins over detection, and unblocks the buttons while it runs. */
  const touchServers = () => {
    serversTouched.current = true;
    setManualServers(true);
  };
  const waiting = detecting && !manualServers;

  const detectedNow = !detecting && detected && detected.email === email.trim().toLowerCase();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy("save");
        try {
          await addAccount(payload);
          toast.success(`${label} connected. Mail is syncing.`);
          onDone();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Could not add the account.");
          setBusy(null);
        }
      }}
    >
      <div className="space-y-5 px-6 pb-6">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Provider">
          {PROVIDERS.map((p) => {
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => choose(p.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-xs font-medium ring-1 transition-all",
                  active
                    ? "bg-brand-soft text-foreground ring-2 ring-brand"
                    : "bg-card text-muted-foreground ring-border hover:bg-accent hover:text-foreground",
                )}
              >
                <p.icon className={cn("size-5", p.tint)} />
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="account-email">Email address</Label>
            <div className="relative">
              <Input
                id="account-email"
                type="email"
                autoComplete="off"
                autoFocus
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  latestEmail.current = e.target.value.trim().toLowerCase();
                }}
                onBlur={() => void detect()}
                placeholder="you@icloud.com, you@gmail.com, you@your-domain.fr"
              />
              {detecting && (
                <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>
            {detectedNow && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-success">✓ {detected.label}</span> detected {SOURCE_NOTE[detected.source]}.
              </p>
            )}
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
            <p className="text-xs leading-relaxed text-muted-foreground">
              {custom && detectedNow && detected.help ? detected.help : preset.help}{" "}
              {link && (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
                >
                  {link.label}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-label">Name in the sidebar</Label>
              <Input
                id="account-label"
                value={label}
                onChange={(e) => {
                  setLabel(e.target.value);
                  setLabelTouched(true);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Lands in space</Label>
              <Select
                value={space}
                onValueChange={(value) => value && setSpace(value)}
                items={Object.fromEntries(spaces.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger className="w-full" aria-label="Default space">
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
        </div>

        <div className="rounded-xl bg-surface ring-1 ring-border">
          <button
            type="button"
            onClick={() => setShowServers((v) => !v)}
            aria-expanded={custom || showServers}
            disabled={custom}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs"
          >
            <span className="font-medium">Server settings</span>
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <span className="truncate font-mono">
                {custom
                  ? imapHost
                    ? imapHost
                    : "required"
                  : `${preset.imapHost} · ${preset.smtpHost}`}
              </span>
              {!custom && (
                <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", showServers && "rotate-180")} />
              )}
            </span>
          </button>
          {custom ? (
            <div className="grid gap-3 border-t px-3 py-3 sm:grid-cols-2">
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="imap-host" className="text-xs">IMAP (incoming)</Label>
                  <Input id="imap-host" value={imapHost} onChange={(e) => { touchServers(); setImapHost(e.target.value.trim()); }} placeholder="imap.example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="imap-port" className="text-xs">Port</Label>
                  <Input
                    id="imap-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={imapPort || ""}
                    onChange={(e) => {
                      touchServers();
                      setImapPort(Number(e.target.value));
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-host" className="text-xs">SMTP (outgoing)</Label>
                  <Input id="smtp-host" value={smtpHost} onChange={(e) => { touchServers(); setSmtpHost(e.target.value.trim()); }} placeholder="smtp.example.com" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-port" className="text-xs">Port</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={smtpPort || ""}
                    onChange={(e) => {
                      touchServers();
                      setSmtpPort(Number(e.target.value));
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
            showServers && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t px-3 py-2.5 font-mono text-xs text-muted-foreground">
                <dt>IMAP</dt>
                <dd className="truncate">{preset.imapHost}:{preset.imapPort}</dd>
                <dt>SMTP</dt>
                <dd className="truncate">{preset.smtpHost}:{preset.smtpPort}</dd>
              </dl>
            )
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t bg-surface px-6 py-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={!ready || busy !== null || waiting}
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
        <Button type="submit" variant="brand" disabled={!ready || busy !== null || waiting}>
          {busy === "save" ? "Connecting…" : "Add mailbox"}
        </Button>
      </div>
    </form>
  );
}
