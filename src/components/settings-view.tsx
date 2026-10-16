"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AddAccountForm } from "@/components/add-account-form";
import { SpaceDot } from "@/components/space-badge";
import { relativeTime } from "@/lib/format";
import { countRuleMatches, RULE_FIELD_LABELS } from "@/lib/routing";
import { SPACE_COLORS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import type { Category, Provider, RuleField, Space, SpaceId } from "@/lib/types";
import { cn } from "@/lib/utils";

function SignOut() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">Sign out</p>
        <p className="text-sm text-muted-foreground">Your mail stays on the server. This only ends this session.</p>
      </div>
      <Button
        variant="outline"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.replace(`${window.location.origin}/login`);
        }}
      >
        Sign out
      </Button>
    </div>
  );
}

const PROVIDER_LABELS: Record<Provider, string> = {
  icloud: "iCloud",
  "ovh-mxplan": "OVH MX Plan",
  imap: "IMAP",
};

const CATEGORY_LABELS: Record<Category, string> = {
  "needs-reply": "Needs reply",
  fyi: "FYI",
  calendar: "Calendar",
  receipt: "Receipt",
  notification: "Notification",
  newsletter: "Newsletter",
};

const KEEP = "__keep";

function SpaceSettings({ space, canDelete }: { space: Space; canDelete: boolean }) {
  const { updateSpace, removeSpace } = useStore();
  const [vips, setVips] = useState(space.vips.join(", "));
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);

  return (
    <div className="space-y-4 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="radiogroup" aria-label={`Colour for ${space.name}`}>
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={space.color === c}
              aria-label="Pick colour"
              onClick={() => updateSpace(space.id, { color: c })}
              className="grid size-5 place-items-center rounded-full"
            >
              <span
                className={cn(
                  "size-3 rounded-full transition-transform",
                  space.color === c && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-card",
                )}
                style={{ backgroundColor: c }}
              />
            </button>
          ))}
        </div>
        <Input
          value={name}
          aria-label="Space name"
          className="h-8 w-40 font-medium"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => (name.trim() ? updateSpace(space.id, { name: name.trim() }) : setName(space.name))}
        />
        <Input
          value={description}
          aria-label="Space description"
          placeholder="What goes here?"
          className="h-8 min-w-0 flex-1"
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => updateSpace(space.id, { description: description.trim() })}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${space.name}`}
          title={canDelete ? `Delete ${space.name}` : "Keep at least one space"}
          disabled={!canDelete}
          onClick={() => {
            removeSpace(space.id);
            toast(`Deleted ${space.name}`, {
              description: "Its accounts moved to your first space and its rules were updated.",
            });
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`vips-${space.id}`} className="text-xs text-muted-foreground">
            VIP senders (emails or domains, comma separated)
          </Label>
          <Input
            id={`vips-${space.id}`}
            value={vips}
            placeholder="boss@company.com, family.fr"
            onChange={(e) => setVips(e.target.value)}
            onBlur={() =>
              updateSpace(space.id, {
                vips: vips.split(",").map((v) => v.trim()).filter(Boolean),
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`sla-${space.id}`} className="text-xs text-muted-foreground">
            Reply target (hours)
          </Label>
          <Input
            id={`sla-${space.id}`}
            type="number"
            min={0}
            className="w-28"
            placeholder="None"
            value={space.slaHours ?? ""}
            onChange={(e) =>
              updateSpace(space.id, {
                slaHours: e.target.value ? Math.max(0, Number(e.target.value)) : undefined,
              })
            }
          />
        </div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <Switch
            checked={Boolean(space.focusHours)}
            onCheckedChange={(on) =>
              updateSpace(space.id, {
                focusHours: on ? { start: 8, end: 19, weekdaysOnly: true } : undefined,
              })
            }
          />
          <span>
            Focus hours
            <span className="block text-xs text-muted-foreground">Weekdays 8:00–19:00</span>
          </span>
        </label>
      </div>
    </div>
  );
}

function NewSpaceForm() {
  const { addSpace } = useStore();
  const [name, setName] = useState("");

  return (
    <form
      className="flex gap-2 rounded-xl border border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        addSpace(name.trim());
        toast.success(`Created ${name.trim()}`, {
          description: "Point an account or a rule at it to fill it.",
        });
        setName("");
      }}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="New space, e.g. Newsletters or Plume"
        aria-label="New space name"
      />
      <Button type="submit" disabled={!name.trim()}>
        <Plus />
        Add space
      </Button>
    </form>
  );
}

function NewRuleForm() {
  const { spaces, addRule } = useStore();
  const [field, setField] = useState<RuleField>("fromDomain");
  const [value, setValue] = useState("");
  const [space, setSpace] = useState<string>(KEEP);
  const [category, setCategory] = useState<string>(KEEP);
  const valid = value.trim() && (space !== KEEP || category !== KEEP);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    addRule({
      field,
      value: value.trim(),
      space: space === KEEP ? undefined : (space as SpaceId),
      category: category === KEEP ? undefined : (category as Category),
    });
    setValue("");
    toast.success("Rule added. It applies to existing mail right away.");
  };

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl border border-dashed p-3 md:grid-cols-[auto_1fr_auto_auto_auto]">
      <Select
        value={field}
        onValueChange={(v) => v && setField(v as RuleField)}
        items={RULE_FIELD_LABELS}
      >
        <SelectTrigger className="w-full md:w-40" aria-label="Match on">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(RULE_FIELD_LABELS) as RuleField[]).map((f) => (
            <SelectItem key={f} value={f}>
              {RULE_FIELD_LABELS[f]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={field === "fromDomain" ? "stripe.com" : field === "to" ? "alex@tallyhq.app" : "value"}
        aria-label="Value"
      />
      <Select
        value={space}
        onValueChange={(v) => v && setSpace(v)}
        items={{ [KEEP]: "Keep space", ...Object.fromEntries(spaces.map((s) => [s.id, `→ ${s.name}`])) }}
      >
        <SelectTrigger className="w-full md:w-40" aria-label="Route to space">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP}>Keep space</SelectItem>
          {spaces.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              → {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={category}
        onValueChange={(v) => v && setCategory(v)}
        items={{ [KEEP]: "Keep category", ...CATEGORY_LABELS }}
      >
        <SelectTrigger className="w-full md:w-40" aria-label="Set category">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={KEEP}>Keep category</SelectItem>
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
            <SelectItem key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="submit" disabled={!valid}>
        <Plus />
        Add rule
      </Button>
    </form>
  );
}

export function SettingsView() {
  const store = useStore();
  const { ready, accounts, spaces, rules, threads, now, updateAccount, removeRule, removeAccount, syncAccount } = store;

  if (!ready) {
    return (
      <div className="mx-auto h-full w-full max-w-4xl space-y-6 overflow-y-auto px-4 py-8 md:px-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto h-full w-full max-w-4xl space-y-6 overflow-y-auto overscroll-contain px-4 py-6 md:px-8 md:py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Decide which mailbox feeds which space, who counts as a VIP, and how mail gets routed.
        </p>
      </header>

      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
        Mailbox passwords stay encrypted on this server. iCloud needs an app-specific password.
        OVH MX Plan uses the mailbox password from Web Cloud, then Emails.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Each account lands in a default space. Rules below can override it.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {accounts.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  {a.label}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {PROVIDER_LABELS[a.provider]}
                  </span>
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {a.email}
                  {a.aliases.length > 0 && ` + ${a.aliases.join(", ")}`}
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground/80">
                  IMAP {a.imapHost}:{a.imapPort ?? 993} · SMTP {a.smtpHost}:{a.smtpPort ?? 587}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.syncing
                    ? "Syncing…"
                    : a.lastSyncAt
                      ? relativeTime(a.lastSyncAt, now) === "now"
                        ? "Synced just now"
                        : `Synced ${relativeTime(a.lastSyncAt, now)} ago`
                      : "Not synced yet"}
                  {a.syncError ? ` · ${a.syncError}` : ""}
                </p>
              </div>
              <Select
                value={a.defaultSpace}
                onValueChange={(v) => v && updateAccount(a.id, { defaultSpace: v as SpaceId })}
                items={Object.fromEntries(spaces.map((s) => [s.id, s.name]))}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label={`Default space for ${a.email}`}>
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
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={a.syncing}
                  onClick={() =>
                    syncAccount(a.id)
                      .then(() => toast.success(`${a.label} synced`))
                      .catch((err: unknown) =>
                        toast.error(err instanceof Error ? err.message : "Sync failed"),
                      )
                  }
                >
                  Sync
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${a.label}`}
                  onClick={() =>
                    removeAccount(a.id)
                      .then(() => toast.success(`${a.label} removed`))
                      .catch((err: unknown) =>
                        toast.error(err instanceof Error ? err.message : "Could not remove it"),
                      )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
            <p className="pb-3 text-sm text-muted-foreground">No mailboxes yet.</p>
          )}
          <div className="pt-3">
            <AddAccountForm />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Spaces</CardTitle>
          <CardDescription>
            VIPs get +35 priority. Threads past the reply target get +30. Outside focus hours a
            space is muted (−20).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="divide-y">
            {spaces.map((s) => (
              <SpaceSettings key={s.id} space={s} canDelete={spaces.length > 1} />
            ))}
          </div>
          <NewSpaceForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Routing rules</CardTitle>
          <CardDescription>
            Evaluated top to bottom; the first rule that sets a space wins, same for category.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <NewRuleForm />
          {rules.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No rules yet. Mail follows each account&apos;s default space.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {rules.map((r) => {
                const target = spaces.find((s) => s.id === r.space);
                const matches = countRuleMatches(r, threads);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                    <span className="text-muted-foreground">{RULE_FIELD_LABELS[r.field]}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.value}</code>
                    <span className="flex flex-1 flex-wrap items-center gap-2">
                      {target && (
                        <span className="inline-flex items-center gap-1.5">
                          → <SpaceDot space={target} /> {target.name}
                        </span>
                      )}
                      {r.category && (
                        <span className="rounded-full border px-2 py-0.5 text-xs">
                          {CATEGORY_LABELS[r.category]}
                        </span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {matches} {matches === 1 ? "match" : "matches"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete rule"
                      onClick={() => removeRule(r.id)}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <SignOut />
    </div>
  );
}
