"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { Building, FolderKanban, Hash, Inbox, Landmark, Menu, Settings, SunMedium, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PRIORITY_THRESHOLD } from "@/lib/priority";
import type { Space } from "@/lib/types";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function Logo() {
  return (
    <Link href="/" className="px-2 text-sm font-medium tracking-tight">
      Clarity Mail
    </Link>
  );
}

const SPACE_ICONS: Record<string, LucideIcon> = {
  company: Building,
  projects: FolderKanban,
  personal: UserRound,
  admin: Landmark,
};

function SpaceIcon({ space }: { space: Space }) {
  const Icon = SPACE_ICONS[space.id] ?? Hash;
  return <Icon strokeWidth={1.75} style={{ color: space.color }} />;
}

function NavItem({
  href,
  active,
  label,
  count,
  onNavigate,
  icon,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
  onNavigate?: () => void;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex h-8 items-center gap-2.5 px-2 text-sm transition-colors",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span className={cn("grid size-4 shrink-0 place-items-center [&_svg]:size-4", active ? "text-foreground" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {count ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
    </Link>
  );
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Suspense fallback={<NavLinks pathname={null} onNavigate={onNavigate} />}>
      <NavWithPathname onNavigate={onNavigate} />
    </Suspense>
  );
}

function NavWithPathname({ onNavigate }: { onNavigate?: () => void }) {
  return <NavLinks pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavLinks({ pathname, onNavigate }: { pathname: string | null; onNavigate?: () => void }) {
  const { spaces, scored, ready } = useStore();
  const inbox = scored.filter((t) => t.status === "inbox");
  const unread = (id?: string) =>
    inbox.filter((t) => t.unread && (!id || t.space === id)).length;
  const urgent = inbox.filter((t) => t.score >= PRIORITY_THRESHOLD).length;

  return (
    <nav className="flex flex-1 flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <NavItem
          href="/"
          active={pathname === "/"}
          icon={<SunMedium strokeWidth={1.75} />}
          label="Brief"
          count={ready ? urgent : undefined}
          onNavigate={onNavigate}
        />
        <NavItem
          href="/inbox/all"
          active={pathname === "/inbox/all"}
          icon={<Inbox strokeWidth={1.75} />}
          label="All inboxes"
          count={ready ? unread() : undefined}
          onNavigate={onNavigate}
        />
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-xs text-muted-foreground">Spaces</p>
        {spaces.map((s) => (
          <NavItem
            key={s.id}
            href={`/inbox/${s.id}`}
            active={pathname === `/inbox/${s.id}`}
            icon={<SpaceIcon space={s} />}
            label={s.name}
            count={unread(s.id)}
            onNavigate={onNavigate}
          />
        ))}
        {!ready &&
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="mx-2 my-1.5 h-5 animate-pulse rounded bg-muted" />
          ))}
      </div>

      <div className="mt-auto flex flex-col gap-0.5">
        <NavItem
          href="/settings"
          active={pathname === "/settings"}
          icon={<Settings strokeWidth={1.75} />}
          label="Settings"
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}

function MailboxNotice() {
  const { notice, ready } = useStore();
  if (!ready || !notice) return null;
  return (
    <p className="shrink-0 border-b border-border/80 px-4 py-2 text-xs leading-relaxed text-muted-foreground">{notice}</p>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <aside
        className={`hidden h-full w-52 shrink-0 flex-col gap-8 overflow-y-auto overscroll-contain border-r border-border/80 bg-sidebar px-4 py-8 md:flex ${
          process.env.NODE_ENV === "development" ? "pb-16" : ""
        }`}
      >
        <Logo />
        <Nav />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MailboxNotice />
        <header className="z-30 box-content flex h-12 shrink-0 items-center gap-2 border-b bg-background/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
          <Button variant="ghost" size="icon-sm" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <Logo />
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
        <SheetContent side="left" className="w-72 gap-6 bg-sidebar px-3 py-4">
          <SheetHeader className="p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <Logo />
          </SheetHeader>
          <Nav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
