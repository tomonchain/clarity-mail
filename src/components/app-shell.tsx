"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTheme } from "next-themes";
import {
  Building,
  FolderKanban,
  Hash,
  Inbox,
  Info,
  Landmark,
  Laptop,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  SunMedium,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Wordmark } from "@/components/brand";
import { DesktopBridge } from "@/components/desktop-bridge";
import { NativeBridge } from "@/components/native-bridge";
import { toast } from "sonner";
import { FOLDERS, folderOf } from "@/lib/folders";
import { UpdatedNotice, UpdatePill } from "@/components/release-notes";
import { SearchButton, SearchProvider } from "@/components/search-dialog";
import { Button } from "@/components/ui/button";
import { ComposeButton, ComposeProvider } from "@/components/compose";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { relativeTime } from "@/lib/format";
import { PRIORITY_THRESHOLD } from "@/lib/priority";
import type { Account, Space } from "@/lib/types";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const SPACE_ICONS: Record<string, LucideIcon> = {
  company: Building,
  projects: FolderKanban,
  personal: UserRound,
  admin: Landmark,
};

export function SpaceIcon({ space, className }: { space: Space; className?: string }) {
  const Icon = SPACE_ICONS[space.id] ?? Hash;
  return <Icon strokeWidth={1.9} className={className} style={{ color: space.color }} />;
}

function NavItem({
  href,
  active,
  label,
  count,
  highlight,
  onNavigate,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  highlight?: boolean;
  onNavigate?: () => void;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <span
        className={cn(
          "grid size-4 shrink-0 place-items-center [&_svg]:size-[15px]",
          active ? "text-sidebar-accent-foreground" : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count ? (
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-medium tabular-nums",
            highlight ? "bg-brand text-brand-foreground" : "text-muted-foreground",
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">{children}</p>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavLinks pathname={null} tab={null} accountId={null} onNavigate={onNavigate} />}>
      <NavWithPathname onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavWithPathname({ onNavigate }: { onNavigate?: () => void }) {
  const params = useSearchParams();
  return (
    <NavLinks
      pathname={usePathname()}
      tab={params.get("tab")}
      accountId={params.get("account")}
      onNavigate={onNavigate}
    />
  );
}

function accountStatus(account: Account, now: number) {
  if (account.syncing) return { tone: "bg-brand animate-pulse", text: "Syncing…" };
  if (account.syncError) return { tone: "bg-destructive", text: account.syncError };
  if (account.lastSyncAt) return { tone: "bg-success", text: `Synced ${relativeTime(account.lastSyncAt, now)} ago` };
  return { tone: "bg-muted-foreground/40", text: "Not synced yet" };
}

function AccountRow({
  account,
  active,
  unread,
  onNavigate,
}: {
  account: Account;
  active: boolean;
  unread: number;
  onNavigate?: () => void;
}) {
  const { syncAccount, now } = useStore();
  const status = accountStatus(account, now);
  const sync = () =>
    void syncAccount(account.id).catch((err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Sync failed"),
    );
  return (
    <div className="group relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              href={`/inbox/all?account=${encodeURIComponent(account.id)}`}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60",
              )}
            />
          }
        >
          <span className="grid size-4 shrink-0 place-items-center">
            <span className={cn("size-2 rounded-full ring-2 ring-sidebar", status.tone)} />
          </span>
          <span className="flex-1 truncate">{account.label || account.email}</span>
          {unread > 0 && (
            <span
              className={cn(
                "min-w-5 rounded-full px-1.5 text-center text-[11px] leading-5 font-medium text-muted-foreground tabular-nums transition-opacity group-hover:opacity-0",
                account.syncing && "opacity-0",
              )}
            >
              {unread}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-64 flex-col items-start gap-0.5">
          <span className="font-medium">{account.email}</span>
          <span className="opacity-75">{status.text}</span>
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={sync}
        disabled={account.syncing}
        aria-label={`Sync ${account.label || account.email}`}
        title="Sync now"
        className={cn(
          "absolute top-1 right-1 grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100",
          account.syncing && "opacity-100",
        )}
      >
        <RefreshCw className={cn("size-3.5", account.syncing && "animate-spin")} />
      </button>
    </div>
  );
}

const noop = () => () => {};

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = mounted ? (theme ?? "system") : "system";
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Laptop;
  const label = current === "light" ? "Light" : current === "dark" ? "Dark" : "Match system";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Appearance: ${label}`}
            onClick={() => setTheme(next)}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>Appearance: {label}</TooltipContent>
    </Tooltip>
  );
}

function NavLinks({
  pathname,
  tab,
  accountId,
  onNavigate,
}: {
  pathname: string | null;
  tab: string | null;
  accountId: string | null;
  onNavigate?: () => void;
}) {
  const { spaces, accounts, scored, ready } = useStore();
  const inbox = scored.filter((t) => t.status === "inbox");
  const unread = (id?: string) => inbox.filter((t) => t.unread && (!id || t.space === id)).length;
  const urgent = inbox.filter((t) => t.score >= PRIORITY_THRESHOLD).length;
  const folder = folderOf(tab);
  const plain = !folder && !accountId;
  const folderCount = (id: string) =>
    id === "snoozed"
      ? scored.filter((t) => t.status === "snoozed").length
      : id === "spam"
        ? scored.filter((t) => t.status === "spam").length
        : undefined;

  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-5">
      <ComposeButton onClick={onNavigate} />
      <div className="flex flex-col gap-px">
        <NavItem
          href="/"
          active={pathname === "/"}
          icon={<SunMedium strokeWidth={1.9} />}
          label="Brief"
          count={ready ? urgent : undefined}
          highlight
          onNavigate={onNavigate}
        />
        <NavItem
          href="/inbox/all"
          active={pathname === "/inbox/all" && plain}
          icon={<Inbox strokeWidth={1.9} />}
          label="All inboxes"
          count={ready ? unread() : undefined}
          onNavigate={onNavigate}
        />
        {FOLDERS.map((f) => (
          <NavItem
            key={f.id}
            href={`/inbox/all?tab=${f.id}`}
            active={pathname === "/inbox/all" && folder?.id === f.id && !accountId}
            icon={<f.icon strokeWidth={1.9} />}
            label={f.label}
            count={ready ? folderCount(f.id) : undefined}
            onNavigate={onNavigate}
          />
        ))}
      </div>

      <div className="flex flex-col gap-px">
        <SectionLabel>Spaces</SectionLabel>
        {spaces.map((s) => (
          <NavItem
            key={s.id}
            href={`/inbox/${s.id}`}
            active={pathname === `/inbox/${s.id}` && plain}
            icon={<SpaceIcon space={s} />}
            label={s.name}
            count={unread(s.id)}
            onNavigate={onNavigate}
          />
        ))}
        {!ready &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mx-2.5 my-1.5 h-5 animate-pulse rounded-md bg-sidebar-accent" />
          ))}
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-col gap-px">
          <SectionLabel>Mailboxes</SectionLabel>
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              active={pathname === "/inbox/all" && accountId === a.id && !folder}
              unread={inbox.filter((t) => t.unread && t.accountId === a.id).length}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}

      <div className="mt-auto space-y-2">
        <UpdatePill onNavigate={onNavigate} />
        <div className="flex items-center gap-1 border-t border-sidebar-border pt-3">
          <div className="flex-1">
            <NavItem
              href="/settings"
              active={pathname === "/settings"}
              icon={<Settings strokeWidth={1.9} />}
              label="Settings"
              onNavigate={onNavigate}
            />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}

function MailboxNotice() {
  const { notice, ready } = useStore();
  if (!ready || !notice) return null;
  return (
    <p className="flex shrink-0 items-start gap-2 border-b bg-surface px-4 py-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0 text-brand" />
      {notice}
    </p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const settings = usePathname()?.startsWith("/settings");

  return (
    <ComposeProvider>
      <SearchProvider>
      <DesktopBridge />
      <UpdatedNotice />
      <NativeBridge />
      <div className="flex h-dvh w-full overflow-hidden bg-background">
        <aside
          className={cn(
            "scroll-thin hidden h-full w-60 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-sidebar-border bg-sidebar px-3 pb-3 md:flex",
            process.env.NODE_ENV === "development" && "pb-16",
          )}
        >
          <div className="desktop-drag flex h-14 shrink-0 items-center px-1.5 in-[.desktop-app]:h-auto in-[.desktop-app]:pt-11 in-[.desktop-app]:pb-4">
            <Link href="/" aria-label="Clarity Mail, home">
              <Wordmark />
            </Link>
          </div>
          <Nav />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MailboxNotice />
          <header className="z-30 box-content flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:hidden">
            <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={() => setOpen(true)}>
              <Menu />
            </Button>
            <Link href="/" aria-label="Clarity Mail, home">
              <Wordmark />
            </Link>
            {!settings && <SearchButton className="ml-auto" />}
          </header>
          <main
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              process.env.NODE_ENV === "development" ? "pb-16" : "pb-[env(safe-area-inset-bottom)]",
            )}
          >
            {children}
          </main>
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="left" className="w-72 gap-5 bg-sidebar px-3 py-4">
            <SheetHeader className="p-0 px-1.5">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Wordmark />
            </SheetHeader>
            <Nav onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
      </div>
      </SearchProvider>
    </ComposeProvider>
  );
}
