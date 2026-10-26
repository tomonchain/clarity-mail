"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import {
  ArrowUpCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ImagePlus,
  Inbox,
  Laptop,
  Lock,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Shuffle,
  Server,
  ShieldAlert,
  ShieldCheck,
  Split,
  Sun,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AddAccountDialog } from "@/components/add-account-form";
import { ReleaseHistory, SETTINGS_SECTION_EVENT } from "@/components/release-notes";
import type { LockPrefs } from "@/components/desktop-bridge";
import { SenderAvatar } from "@/components/sender-avatar";
import { SpaceDot } from "@/components/space-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { setDisplayPref, useDisplayPrefs, type DisplayPrefs } from "@/lib/display";
import { greeting, relativeTime } from "@/lib/format";
import { APP_COMMIT, APP_VERSION } from "@/lib/releases";
import { checkForUpdates, useUpdates } from "@/lib/updates";
import {
  firstName,
  lockPhoto,
  nextLockPhoto,
  setCustomPhoto,
  setLockBackground,
  setOwnerName,
  shrinkPhoto,
  usePersonal,
  type LockBackground,
} from "@/lib/personal";
import { forgetTrustedSenders, setImageMode, useImagePrefs } from "@/lib/privacy";
import { countRuleMatches, RULE_FIELD_LABELS } from "@/lib/routing";
import { SPACE_COLORS } from "@/lib/seed";
import { useStore } from "@/lib/store";
import type { Account, Category, Provider, RuleField, Space, SpaceId } from "@/lib/types";
import { cn } from "@/lib/utils";

/* ---------- shared bits ---------- */

const PROVIDER_LABELS: Record<Provider, string> = {
  icloud: "iCloud",
  gmail: "Gmail",
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

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("overflow-hidden rounded-xl bg-card shadow-card", className)} {...props} />;
}

function EmptyPanel({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Inbox;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <Panel className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      </div>
      {action}
    </Panel>
  );
}

function SpaceSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: string;
  onChange: (id: SpaceId) => void;
  label: string;
  className?: string;
}) {
  const { spaces } = useStore();
  return (
    <Select
      value={value}
      onValueChange={(v) => v && onChange(v as SpaceId)}
      items={Object.fromEntries(spaces.map((s) => [s.id, s.name]))}
    >
      <SelectTrigger className={className} aria-label={label}>
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
  );
}

/* ---------- Mailboxes ---------- */

function syncLine(a: Account, now: number) {
  if (a.syncing) return "Syncing…";
  if (!a.lastSyncAt) return "Not synced yet";
  const ago = relativeTime(a.lastSyncAt, now);
  return ago === "now" ? "Synced just now" : `Synced ${ago} ago`;
}

function AccountRow({
  account: a,
  onEdit,
  onRemove,
}: {
  account: Account;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { now, updateAccount, syncAccount } = useStore();
  const [details, setDetails] = useState(false);

  const sync = () =>
    syncAccount(a.id)
      .then(() => toast.success(`${a.label} synced`))
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Sync failed"));

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <SenderAvatar name={a.label} email={a.email} size="lg" />
          <span
            className={cn(
              "absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-card",
              a.syncing
                ? "animate-pulse bg-brand"
                : a.syncError
                  ? "bg-destructive"
                  : a.lastSyncAt
                    ? "bg-success"
                    : "bg-muted-foreground/40",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <button
              type="button"
              onClick={onEdit}
              className="truncate rounded-sm text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              title="Rename"
            >
              {a.label}
            </button>
            <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {PROVIDER_LABELS[a.provider]}
            </span>
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {a.email}
            {a.aliases.length > 0 && ` + ${a.aliases.join(", ")}`}
          </p>
          <p className={cn("truncate text-xs", a.syncError ? "text-destructive" : "text-muted-foreground/80")}>
            {a.syncError ? a.syncError : syncLine(a, now)}
          </p>
        </div>
        <SpaceSelect
          value={a.defaultSpace}
          onChange={(id) => updateAccount(a.id, { defaultSpace: id })}
          label={`Space for ${a.email}`}
          className="hidden w-40 sm:flex"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={`Options for ${a.label}`} />}
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil />
              Rename & edit…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={a.syncing} onClick={sync}>
              <RefreshCw />
              Sync now
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDetails((v) => !v)}>
              <Server />
              {details ? "Hide server details" : "Server details"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2 />
              Remove…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-3 sm:hidden">
        <SpaceSelect
          value={a.defaultSpace}
          onChange={(id) => updateAccount(a.id, { defaultSpace: id })}
          label={`Space for ${a.email}`}
          className="w-full"
        />
      </div>
      {details && (
        <dl className="mt-3 ml-13 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-surface px-3 py-2 font-mono text-xs text-muted-foreground">
          <dt>IMAP</dt>
          <dd className="truncate">{a.imapHost}:{a.imapPort ?? 993}</dd>
          <dt>SMTP</dt>
          <dd className="truncate">{a.smtpHost}:{a.smtpPort ?? 587}</dd>
        </dl>
      )}
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EditAccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {account && <EditAccountForm key={account.id} account={account} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditAccountForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { updateAccount, updateAccountPassword } = useStore();
  const [label, setLabel] = useState(account.label);
  const [aliases, setAliases] = useState(account.aliases.join(", "));
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = label.trim();
    if (!name) return setError("Give the mailbox a name.");
    const list = aliases
      .split(/[\s,;]+/)
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
    const bad = list.find((a) => !EMAIL_RE.test(a));
    if (bad) return setError(`"${bad}" is not an email address.`);
    setError(null);
    setBusy(true);
    try {
      if (password) await updateAccountPassword(account.id, password);
      const patch: Partial<Account> = {};
      if (name !== account.label) patch.label = name;
      if (list.join(",") !== account.aliases.join(",")) patch.aliases = list;
      if (Object.keys(patch).length > 0) updateAccount(account.id, patch);
      toast.success(password ? `${name} updated, password checked` : `${name} saved`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">Edit mailbox</DialogTitle>
        <DialogDescription>{account.email}</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="edit-label">Name</Label>
        <Input id="edit-label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus maxLength={80} />
        <p className="text-xs text-muted-foreground">Shown in the sidebar and next to each conversation.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-aliases">Other addresses on this mailbox</Label>
        <Input
          id="edit-aliases"
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          placeholder="contact@domain.com, hello@domain.com"
        />
        <p className="text-xs text-muted-foreground">Aliases you send from. Separate them with commas.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="edit-password">New password</Label>
        <Input
          id="edit-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Leave empty to keep the current one"
          autoComplete="new-password"
        />
        {account.syncError && (
          <p className="text-xs text-muted-foreground">
            Sync is failing. If the password or app password changed, paste the new one here.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={busy}>
          {busy ? (password ? "Checking password…" : "Saving…") : "Save"}
        </Button>
      </div>
    </form>
  );
}

function RemoveAccountDialog({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { removeAccount } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Remove {account?.label}?</DialogTitle>
          <DialogDescription>
            {account?.email} stops syncing and its mail leaves Clarity Mail. Nothing is deleted on the server; you can add
            it back at any time.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              if (!account) return;
              setBusy(true);
              try {
                await removeAccount(account.id);
                toast.success(`${account.label} removed`);
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not remove it");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Removing…" : "Remove mailbox"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MailboxesSection() {
  const { accounts } = useStore();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const add = (
    <Button variant="brand" onClick={() => setAdding(true)}>
      <Plus />
      Add mailbox
    </Button>
  );

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Mailboxes"
        description="Every mailbox syncs into the same inbox. Choose the space each one lands in."
        action={accounts.length > 0 ? add : undefined}
      />
      {accounts.length === 0 ? (
        <EmptyPanel
          icon={Inbox}
          title="No mailbox yet"
          text="Connect iCloud, Gmail, OVH MX Plan or any IMAP address. Clarity Mail finds the servers for you."
          action={add}
        />
      ) : (
        <Panel className="divide-y">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onEdit={() => setEditing(a)} onRemove={() => setRemoving(a)} />
          ))}
        </Panel>
      )}
      <AddAccountDialog open={adding} onOpenChange={setAdding} />
      <EditAccountDialog account={editing} onClose={() => setEditing(null)} />
      <RemoveAccountDialog account={removing} onClose={() => setRemoving(null)} />
    </section>
  );
}

/* ---------- Spaces ---------- */

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

function SpaceEditor({ space, canDelete }: { space: Space; canDelete: boolean }) {
  const { updateSpace, removeSpace } = useStore();
  const [vips, setVips] = useState(space.vips.join(", "));
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);

  return (
    <div className="space-y-5 border-t bg-surface px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor={`name-${space.id}`} className="text-xs">Name</Label>
          <Input
            id={`name-${space.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (name.trim() ? updateSpace(space.id, { name: name.trim() }) : setName(space.name))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`desc-${space.id}`} className="text-xs">Description</Label>
          <Input
            id={`desc-${space.id}`}
            value={description}
            placeholder="What goes here?"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => updateSpace(space.id, { description: description.trim() })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Colour</p>
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label={`Colour for ${space.name}`}>
          {SPACE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={space.color === c}
              aria-label="Pick colour"
              onClick={() => updateSpace(space.id, { color: c })}
              className="grid size-6 place-items-center rounded-full"
            >
              <span
                className={cn(
                  "size-4 rounded-full transition-transform",
                  space.color === c && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-surface",
                )}
                style={{ backgroundColor: c }}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`vips-${space.id}`} className="text-xs">VIP senders</Label>
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
        <p className="text-xs text-muted-foreground">Emails or whole domains, separated by commas. Their mail goes to the top.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`sla-${space.id}`} className="text-xs">Reply target</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`sla-${space.id}`}
              type="number"
              min={0}
              className="w-24"
              placeholder="None"
              value={space.slaHours ?? ""}
              onChange={(e) =>
                updateSpace(space.id, {
                  slaHours: e.target.value ? Math.max(0, Number(e.target.value)) : undefined,
                })
              }
            />
            <span className="text-sm text-muted-foreground">hours</span>
          </div>
          <p className="text-xs text-muted-foreground">Unanswered threads past this rise in priority.</p>
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Focus hours</p>
          <label className="flex h-8 items-center gap-2 text-sm">
            <Switch
              checked={Boolean(space.focusHours)}
              onCheckedChange={(on) =>
                updateSpace(space.id, {
                  focusHours: on ? { start: 8, end: 19, weekdaysOnly: true } : undefined,
                })
              }
            />
            Weekdays 8:00–19:00
          </label>
          <p className="text-xs text-muted-foreground">Outside these hours the space stays quiet.</p>
        </div>
      </div>

      <div className="flex justify-end border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!canDelete}
          title={canDelete ? undefined : "Keep at least one space"}
          onClick={() => {
            removeSpace(space.id);
            toast(`Deleted ${space.name}`, {
              description: "Its mailboxes moved to your first space and its rules were updated.",
            });
          }}
        >
          <Trash2 />
          Delete space
        </Button>
      </div>
    </div>
  );
}

function SpaceRow({
  space,
  open,
  onToggle,
  canDelete,
}: {
  space: Space;
  open: boolean;
  onToggle: () => void;
  canDelete: boolean;
}) {
  const { accounts } = useStore();
  const mailboxes = accounts.filter((a) => a.defaultSpace === space.id).length;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/50"
      >
        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: space.color }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{space.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {space.description || "No description"}
          </span>
        </span>
        <span className="hidden flex-wrap justify-end gap-1 sm:flex">
          <Chip>
            {mailboxes} {mailboxes === 1 ? "mailbox" : "mailboxes"}
          </Chip>
          {space.vips.length > 0 && <Chip>{space.vips.length} VIP</Chip>}
          {space.slaHours != null && <Chip>Reply ≤ {space.slaHours}h</Chip>}
          {space.focusHours && <Chip>Focus hours</Chip>}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <SpaceEditor space={space} canDelete={canDelete} />}
    </div>
  );
}

function NewSpaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { addSpace } = useStore();
  const [name, setName] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setName("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">New space</DialogTitle>
          <DialogDescription>A space groups mail for one part of your life or business.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addSpace(name.trim());
            toast.success(`Created ${name.trim()}`, {
              description: "Point a mailbox or a rule at it to fill it.",
            });
            setName("");
            onOpenChange(false);
          }}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Clients, Newsletters, Family"
            aria-label="Space name"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={!name.trim()}>
              Create space
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SpacesSection() {
  const { spaces } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Spaces"
        description="Spaces sort your mail by part of your life. Open one to edit it."
        action={
          <Button variant="outline" onClick={() => setCreating(true)}>
            <Plus />
            New space
          </Button>
        }
      />
      <Panel className="divide-y">
        {spaces.map((s) => (
          <SpaceRow
            key={s.id}
            space={s}
            open={openId === s.id}
            onToggle={() => setOpenId((id) => (id === s.id ? null : s.id))}
            canDelete={spaces.length > 1}
          />
        ))}
      </Panel>
      <p className="px-1 text-xs text-muted-foreground">
        How priority works: VIP senders +35 · past the reply target +30 · outside focus hours −20.
      </p>
      <NewSpaceDialog open={creating} onOpenChange={setCreating} />
    </section>
  );
}

/* ---------- Rules ---------- */

function RuleBuilder() {
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
    setSpace(KEEP);
    setCategory(KEEP);
    toast.success("Rule added. It applies to existing mail right away.");
  };

  return (
    <Panel>
      <form onSubmit={submit} className="space-y-3 p-4">
        <p className="text-sm font-medium">New rule</p>
        <div className="grid items-center gap-2 sm:grid-cols-[3rem_11rem_1fr]">
          <span className="text-sm text-muted-foreground">When</span>
          <Select value={field} onValueChange={(v) => v && setField(v as RuleField)} items={RULE_FIELD_LABELS}>
            <SelectTrigger className="w-full" aria-label="Match on">
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
            placeholder={
              field === "fromDomain"
                ? "stripe.com"
                : field === "to"
                  ? "contact@my-company.fr"
                  : field === "fromEmail"
                    ? "someone@example.com"
                    : "invoice"
            }
            aria-label="Value"
          />
        </div>
        <div className="grid items-center gap-2 sm:grid-cols-[3rem_1fr_1fr_auto]">
          <span className="text-sm text-muted-foreground">Then</span>
          <Select
            value={space}
            onValueChange={(v) => v && setSpace(v)}
            items={{ [KEEP]: "Keep the space", ...Object.fromEntries(spaces.map((s) => [s.id, `Move to ${s.name}`])) }}
          >
            <SelectTrigger className="w-full" aria-label="Route to space">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>Keep the space</SelectItem>
              {spaces.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <SpaceDot space={s} />
                  Move to {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={category}
            onValueChange={(v) => v && setCategory(v)}
            items={{
              [KEEP]: "Keep the category",
              ...Object.fromEntries(Object.entries(CATEGORY_LABELS).map(([k, v]) => [k, `Mark as ${v}`])),
            }}
          >
            <SelectTrigger className="w-full" aria-label="Set category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={KEEP}>Keep the category</SelectItem>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                <SelectItem key={c} value={c}>
                  Mark as {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="brand" disabled={!valid}>
            <Plus />
            Add
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function RulesSection() {
  const { spaces, rules, threads, removeRule } = useStore();
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Routing rules"
        description="Send mail to a space or a category automatically. Rules run in order; the first one that matches wins."
      />
      <RuleBuilder />
      {rules.length === 0 ? (
        <EmptyPanel
          icon={Split}
          title="No rules yet"
          text="Mail follows each mailbox's space. Add a rule above to send a sender or an address somewhere else."
        />
      ) : (
        <Panel>
          <ol className="divide-y">
            {rules.map((r, i) => {
              const target = spaces.find((s) => s.id === r.space);
              const matches = countRuleMatches(r, threads);
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-medium tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-muted-foreground">{RULE_FIELD_LABELS[r.field]}</span>
                    <code className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-xs">{r.value}</code>
                    <span className="text-muted-foreground">→</span>
                    {target && (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <SpaceDot space={target} />
                        {target.name}
                      </span>
                    )}
                    {r.category && <Chip>{CATEGORY_LABELS[r.category]}</Chip>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {matches} {matches === 1 ? "match" : "matches"}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label="Delete rule" onClick={() => removeRule(r.id)}>
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
    </section>
  );
}

/* ---------- General ---------- */

const THEMES = [
  { id: "system", label: "System", icon: Laptop },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

const noop = () => () => {};

function SettingRow({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      {children}
    </div>
  );
}

const BACKGROUNDS: { id: LockBackground; label: string }[] = [
  { id: "photos", label: "Photos" },
  { id: "custom", label: "Your photo" },
  { id: "plain", label: "Plain" },
];

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string; icon?: typeof Sun }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-secondary p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
            value === o.id ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small copy of the lock screen, so a choice can be seen before locking. */
function LockPreview() {
  const personal = usePersonal();
  const { now } = useStore();
  const photo = lockPhoto(personal, now, "thumb");
  const name = firstName(personal.name);
  return (
    <div
      className={cn(
        "relative grid aspect-[16/10] w-full max-w-xs place-items-center overflow-hidden rounded-lg ring-1 ring-hairline",
        photo ? "bg-neutral-900 text-white" : "bg-surface",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- remote or data: photo, no optimizer wanted */}
      {photo && <img key={photo.url} src={photo.url} alt="" className="absolute inset-0 size-full object-cover" />}
      {photo && <div className="absolute inset-0 bg-black/25" />}
      <div className={cn("relative text-center", photo && "drop-shadow-[0_1px_6px_oklch(0_0_0/40%)]")}>
        <p className="font-display text-3xl leading-none tabular-nums">
          {new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </p>
        <p className="mt-1.5 font-display text-xs">
          {greeting(now)}
          {name && `, ${name}`}
        </p>
        <div className={cn("mx-auto mt-2.5 h-5 w-24 rounded-md", photo ? "bg-black/30 ring-1 ring-white/20 backdrop-blur" : "bg-card shadow-card")} />
      </div>
      {photo?.author && (
        <p className="absolute right-2 bottom-1 max-w-[70%] truncate text-[9px] text-white/70">{photo.author} · Unsplash</p>
      )}
    </div>
  );
}

function PersonalPanel() {
  const personal = usePersonal();
  // Typed text, so a trailing space survives until the next word.
  const [name, setName] = useState(personal.name);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await shrinkPhoto(file);
      if (!setCustomPhoto(url)) toast.error("This browser could not keep the photo. Try a smaller one.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read this photo.");
    }
  };

  return (
    <Panel className="divide-y">
      <SettingRow title="Your name" text="For greetings, like “Good morning, Thomas”. Kept on this device.">
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setOwnerName(e.target.value);
          }}
          placeholder="First name"
          aria-label="Your name"
          autoComplete="given-name"
          className="h-8 w-full sm:w-48"
        />
      </SettingRow>
      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Lock screen</p>
            <p className="text-sm text-muted-foreground">
              {personal.background === "photos"
                ? "A new landscape every day, from Unsplash."
                : personal.background === "custom"
                  ? "A photo of your own, stored on this device."
                  : "No photo, just Clarity."}
            </p>
          </div>
          <Segmented
            label="Lock screen background"
            value={personal.background === "custom" && !personal.custom ? "photos" : personal.background}
            options={BACKGROUNDS}
            onChange={(id) => (id === "custom" && !personal.custom ? fileRef.current?.click() : setLockBackground(id))}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <LockPreview />
          <div className="flex flex-wrap gap-2">
            {personal.background === "photos" && (
              <Button variant="outline" size="sm" onClick={nextLockPhoto}>
                <Shuffle />
                Next photo
              </Button>
            )}
            {personal.background !== "plain" && (
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <ImagePlus />
                {personal.custom ? "Change photo…" : "Use my photo…"}
              </Button>
            )}
            {personal.background === "custom" && personal.custom && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCustomPhoto(null)}>
                Remove
              </Button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </Panel>
  );
}

const PREVIEWS: { id: DisplayPrefs["preview"]; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "text", label: "Message text" },
];

const LAYOUTS: { id: DisplayPrefs["layout"]; label: string }[] = [
  { id: "split", label: "Side by side" },
  { id: "full", label: "Full screen" },
];

function MailListPanel() {
  const prefs = useDisplayPrefs();
  return (
    <Panel className="divide-y">
      <SettingRow
        title="Preview"
        text="Under each subject: the gist of the conversation, or the first words of the latest mail."
      >
        <Segmented
          label="Preview"
          value={prefs.preview}
          options={PREVIEWS}
          onChange={(id) => setDisplayPref("preview", id)}
        />
      </SettingRow>
      <SettingRow title="Layout" text="Read next to the list, or open each conversation full screen, as in Spark.">
        <Segmented label="Layout" value={prefs.layout} options={LAYOUTS} onChange={(id) => setDisplayPref("layout", id)} />
      </SettingRow>
      <SettingRow
        title="Sender photos"
        text="Looks up a sender's Gravatar, or their company's icon. Clarity asks for them, not your browser."
      >
        <Switch
          checked={prefs.senderPhotos}
          onCheckedChange={(on) => setDisplayPref("senderPhotos", on)}
          aria-label="Sender photos"
        />
      </SettingRow>
    </Panel>
  );
}

function GeneralSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = mounted ? (theme ?? "system") : "system";

  return (
    <section className="space-y-4">
      <SectionHeader title="General" description="Who you are, how Clarity Mail looks, and your session." />
      <PersonalPanel />
      <MailListPanel />
      <Panel className="divide-y">
        <SettingRow title="Appearance" text="Follow macOS, or keep Clarity Mail light or dark.">
          <Segmented label="Appearance" value={current} options={THEMES} onChange={setTheme} />
        </SettingRow>
        <SettingRow title="Sign out" text="Your mail stays stored. This only ends this session.">
          <Button
            variant="outline"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.replace(`${window.location.origin}/login`);
            }}
          >
            Sign out
          </Button>
        </SettingRow>
      </Panel>
    </section>
  );
}

/* ---------- Updates ---------- */

function UpdatesSection() {
  const { info, checking, available } = useUpdates();
  const { now } = useStore();
  const latest = info?.latest;

  return (
    <section className="space-y-4">
      <SectionHeader title="Updates" description="Which version this is, what changed, and whether a newer one is out." />
      <Panel className="divide-y">
        <div className="flex flex-col items-start gap-3 px-5 py-4 sm:flex-row sm:items-center">
          <span
            className={cn(
              "grid size-9 shrink-0 place-items-center rounded-full",
              available ? "bg-brand-soft text-brand" : "bg-success/12 text-success",
            )}
          >
            {available ? <ArrowUpCircle className="size-[18px]" /> : <CheckCircle2 className="size-[18px]" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {available && latest ? `Version ${latest.version} is out` : `Clarity Mail ${APP_VERSION}`}
            </p>
            <p className="text-sm text-muted-foreground">
              {available
                ? `You have ${APP_VERSION}. Download the new version, then replace the app in Applications. Your mail stays.`
                : checking && !info
                  ? "Checking for updates…"
                  : info?.error === "not-found"
                    ? "Updates can't be checked: the releases repository is private or missing."
                    : info?.error === "unreachable"
                      ? "Couldn't reach GitHub to check for updates."
                      : info
                        ? `Up to date. Checked ${relativeTime(info.checkedAt, now)}.`
                        : "Up to date."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {available && latest && (
              <Button
                variant="brand"
                size="sm"
                render={<a href={latest.download ?? latest.url} target="_blank" rel="noreferrer" />}
                nativeButton={false}
              >
                <Download />
                {latest.download ? "Download" : "Open release"}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={checking} onClick={() => void checkForUpdates(true)}>
              <RefreshCw className={cn(checking && "animate-spin")} />
              Check now
            </Button>
          </div>
        </div>
      </Panel>
      <h3 className="px-1 pt-2 text-[13px] font-semibold tracking-tight">What&apos;s new</h3>
      <Panel>
        <ReleaseHistory />
      </Panel>
    </section>
  );
}

/* ---------- Security ---------- */

type SecurityStatus = {
  encrypted: boolean;
  keySource: "keychain" | "env" | "file";
  fileVault: "on" | "off" | "unknown";
  sessions: number;
  desktop: boolean;
};

const LOCK_CHOICES: { value: string; label: string }[] = [
  { value: "0", label: "Never" },
  { value: "5", label: "After 5 minutes" },
  { value: "15", label: "After 15 minutes" },
  { value: "30", label: "After 30 minutes" },
  { value: "60", label: "After 1 hour" },
];

function StatusLine({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return (
    <div className="flex items-start gap-3 px-5 py-3.5">
      <span
        className={cn(
          "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
          ok ? "bg-success/15 text-success" : "bg-destructive/12 text-destructive",
        )}
      >
        {ok ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function lockNow() {
  const desktop = window.clarityDesktop;
  if (desktop) {
    desktop.lock();
    return;
  }
  void fetch("/api/auth/logout", { method: "POST" }).finally(() =>
    window.location.replace(`${window.location.origin}/login`),
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3 px-5 py-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (next.length < 8) {
          toast.error("Use at least 8 characters.");
          return;
        }
        if (next !== confirm) {
          toast.error("The new passwords don't match.");
          return;
        }
        setBusy(true);
        const res = await fetch("/api/auth/password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ current, next }),
        }).catch(() => null);
        const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
        setBusy(false);
        if (!res?.ok) {
          toast.error(body?.error || "Could not change the password.");
          return;
        }
        setCurrent("");
        setNext("");
        setConfirm("");
        toast.success("Password changed. Other sessions were signed out.");
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="pw-current">Current</Label>
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-next">New</Label>
        <Input
          id="pw-next"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pw-confirm">Confirm new</Label>
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <div className="sm:col-span-3">
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}

function SecuritySection() {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [lockPrefs, setLockPrefs] = useState<LockPrefs | null>(null);
  const [touchId, setTouchId] = useState(false);
  const images = useImagePrefs();

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/security", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<SecurityStatus>) : null))
      .then((body) => {
        if (!cancelled && body) setStatus(body);
      })
      .catch(() => undefined);
    void window.clarityDesktop
      ?.getPrefs()
      .then((prefs) => {
        if (cancelled || !prefs) return;
        setLockPrefs({ lockAfterMinutes: prefs.lockAfterMinutes, lockOnSleep: prefs.lockOnSleep });
        setTouchId(prefs.touchId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLock = (patch: Partial<LockPrefs>) => {
    if (!lockPrefs) return;
    const next = { ...lockPrefs, ...patch };
    setLockPrefs(next);
    void window.clarityDesktop
      ?.setPrefs(next)
      .then((saved) => saved && setLockPrefs(saved))
      .catch(() => toast.error("Could not save that setting."));
  };

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Security"
        description="How your mail is protected on this Mac, and when Clarity locks."
        action={
          <Button variant="outline" onClick={lockNow}>
            <Lock />
            Lock now
          </Button>
        }
      />

      <Panel className="divide-y">
        {!status ? (
          <div className="space-y-3 px-5 py-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <>
            <StatusLine
              ok={status.encrypted}
              title={status.encrypted ? "Mailbox encrypted" : "Mailbox not encrypted"}
              text={
                status.encrypted
                  ? "Messages, contacts and settings are stored with AES-256 (SQLCipher). Mailbox passwords are encrypted too."
                  : "The local mail store is readable on disk. Restart Clarity to encrypt it."
              }
            />
            <StatusLine
              ok={status.keySource !== "file"}
              title={
                status.keySource === "keychain"
                  ? "Key kept in the macOS Keychain"
                  : status.keySource === "env"
                    ? "Key supplied by the server"
                    : "Key stored next to the data"
              }
              text={
                status.keySource === "keychain"
                  ? "Only this Mac user account can unlock it. Copying the files elsewhere gives unreadable data."
                  : status.keySource === "env"
                    ? "The encryption key comes from the server environment, not from disk."
                    : "Fine for development. The Mac app keeps the key in the Keychain instead."
              }
            />
            {status.fileVault !== "unknown" && (
              <StatusLine
                ok={status.fileVault === "on"}
                title={status.fileVault === "on" ? "FileVault is on" : "FileVault is off"}
                text={
                  status.fileVault === "on"
                    ? "The whole disk is encrypted as well."
                    : "Turn it on in System Settings → Privacy & Security to protect the rest of your disk."
                }
              />
            )}
            <StatusLine
              ok
              title="Connections encrypted"
              text="Mail servers must use TLS 1.2 or newer with a valid certificate."
            />
          </>
        )}
      </Panel>

      {lockPrefs && (
        <Panel className="divide-y">
          <SettingRow title="Lock automatically" text="When you have not touched your Mac for a while.">
            <Select
              value={String(lockPrefs.lockAfterMinutes)}
              onValueChange={(v) => v !== null && saveLock({ lockAfterMinutes: Number(v) })}
              items={Object.fromEntries(LOCK_CHOICES.map((c) => [c.value, c.label]))}
            >
              <SelectTrigger className="w-44" aria-label="Lock automatically">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCK_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
          <SettingRow title="Lock when the Mac sleeps" text="Also when the screen locks.">
            <Switch
              checked={lockPrefs.lockOnSleep}
              onCheckedChange={(on) => saveLock({ lockOnSleep: on })}
              aria-label="Lock when the Mac sleeps"
            />
          </SettingRow>
          <SettingRow
            title="Touch ID"
            text={
              touchId
                ? "Unlock Clarity with your fingerprint. Your password always works too."
                : "Not available on this Mac. Use your password to unlock."
            }
          >
            <span className="text-sm text-muted-foreground">{touchId ? "On" : "Unavailable"}</span>
          </SettingRow>
        </Panel>
      )}

      <Panel className="divide-y">
        <SettingRow title="Remote images" text="Blocking them stops senders from tracking when you open mail.">
          <div className="inline-flex rounded-lg bg-secondary p-0.5" role="radiogroup" aria-label="Remote images">
            {(
              [
                { id: "ask", label: "Block" },
                { id: "always", label: "Always load" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={images.mode === m.id}
                onClick={() => setImageMode(m.id)}
                className={cn(
                  "inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
                  images.mode === m.id
                    ? "bg-card text-foreground shadow-soft"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </SettingRow>
        {images.trusted.length > 0 && (
          <SettingRow
            title="Trusted senders"
            text={`Images always load from ${images.trusted.length} sender${images.trusted.length === 1 ? "" : "s"}.`}
          >
            <Button
              variant="outline"
              onClick={() => {
                forgetTrustedSenders();
                toast.success("Trusted senders forgotten");
              }}
            >
              Forget them
            </Button>
          </SettingRow>
        )}
      </Panel>

      <Panel>
        <div className="px-5 pt-4">
          <p className="text-sm font-medium">App password</p>
          <p className="text-sm text-muted-foreground">
            Changing it signs out every other session
            {status && status.sessions > 1 ? ` (${status.sessions - 1} open now)` : ""}.
          </p>
        </div>
        <PasswordForm />
      </Panel>
    </section>
  );
}

/* ---------- Page ---------- */

type Section = "mailboxes" | "spaces" | "rules" | "security" | "general" | "updates";
const SECTIONS: Section[] = ["mailboxes", "spaces", "rules", "security", "general", "updates"];

export function SettingsView() {
  const { ready, accounts, spaces, rules } = useStore();
  // Settings#updates opens on that tab, from the update notice or the sidebar.
  const [section, setSection] = useState<Section>(() => {
    const hash = typeof window === "undefined" ? "" : window.location.hash.slice(1);
    return SECTIONS.includes(hash as Section) ? (hash as Section) : "mailboxes";
  });
  const { available } = useUpdates();

  useEffect(() => {
    const onSection = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (SECTIONS.includes(next as Section)) setSection(next as Section);
    };
    window.addEventListener(SETTINGS_SECTION_EVENT, onSection);
    return () => window.removeEventListener(SETTINGS_SECTION_EVENT, onSection);
  }, []);

  if (!ready) {
    return (
      <div className="h-full overflow-y-auto bg-surface">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-10 md:px-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-96 rounded-lg" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  const sections: { id: Section; label: string; count?: number }[] = [
    { id: "mailboxes", label: "Mailboxes", count: accounts.length },
    { id: "spaces", label: "Spaces", count: spaces.length },
    { id: "rules", label: "Rules", count: rules.length },
    { id: "security", label: "Security" },
    { id: "general", label: "General" },
    { id: "updates", label: "Updates" },
  ];

  return (
    <div className="scroll-thin h-full overflow-y-auto overscroll-contain bg-surface">
      <div className="desktop-drag hidden h-8 in-[.desktop-app]:block" />
      <div className="mx-auto w-full max-w-3xl animate-fade-up space-y-6 px-4 py-6 md:px-8 md:py-10 in-[.desktop-app]:pt-4">
        <header className="space-y-4">
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Settings</h1>
          <div
            className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-secondary p-0.5 [scrollbar-width:none]"
            role="tablist"
            aria-label="Settings sections"
          >
            {sections.map((s) => {
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  id={`tab-${s.id}`}
                  aria-selected={active}
                  aria-controls={`panel-${s.id}`}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium transition-colors",
                    active ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                  {s.id === "updates" && available && <span className="size-1.5 rounded-full bg-brand" aria-label="Update available" />}
                  {s.count !== undefined && (
                    <span className="text-xs tabular-nums text-muted-foreground/70">{s.count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        <div role="tabpanel" id={`panel-${section}`} aria-labelledby={`tab-${section}`} key={section} className="animate-fade-up">
          {section === "mailboxes" && <MailboxesSection />}
          {section === "spaces" && <SpacesSection />}
          {section === "rules" && <RulesSection />}
          {section === "security" && <SecuritySection />}
          {section === "general" && <GeneralSection />}
          {section === "updates" && <UpdatesSection />}
        </div>
        <footer className="pt-4 text-center text-xs text-muted-foreground/80">
          <button type="button" onClick={() => setSection("updates")} className="hover:text-foreground">
            Clarity Mail {APP_VERSION}
            {APP_COMMIT && <span className="font-mono"> · {APP_COMMIT}</span>}
          </button>
        </footer>
      </div>
    </div>
  );
}
