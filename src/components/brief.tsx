"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  BellOff,
  CheckCircle2,
  Hourglass,
  MessageCircleReply,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { SpaceIcon } from "@/components/app-shell";
import { SearchButton, useOpenSearch, useOpenThread } from "@/components/search-dialog";
import { SenderAvatar } from "@/components/sender-avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpaceDot } from "@/components/space-badge";
import { ThreadActions } from "@/components/thread-actions";
import { greeting, plural, relativeTime } from "@/lib/format";
import { firstName, usePersonal } from "@/lib/personal";
import { isLowValue, PRIORITY_THRESHOLD, whyLine } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

const TOP_N = 5;

function BriefSkeleton() {
  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-14 md:px-10">
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}

function SyncNote() {
  const { accounts, now } = useStore();
  if (accounts.length === 0) return null;
  const syncing = accounts.some((a) => a.syncing);
  const failing = accounts.some((a) => a.syncError);
  const last = accounts.reduce((max, a) => Math.max(max, a.lastSyncAt ?? 0), 0);
  const when = !last ? "Waiting for the first sync" : syncing ? "Syncing mailboxes" : syncedLabel(last, now);
  return (
    <p className="inline-flex items-center gap-2 rounded-full bg-card px-2.5 py-1 text-xs text-muted-foreground shadow-card">
      <span
        className={cn(
          "size-1.5 rounded-full",
          failing ? "bg-destructive" : syncing || !last ? "animate-pulse bg-brand" : "bg-success",
        )}
      />
      {when} · {plural(accounts.length, "mailbox", "mailboxes")}
    </p>
  );
}

function syncedLabel(ts: number, now: number) {
  const label = relativeTime(ts, now);
  if (label === "now") return "Synced just now";
  if (/^\d+[mhd]$/.test(label)) return `Synced ${label} ago`;
  return `Synced ${label}`;
}

function SectionTitle({ id, children, action }: { id: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-1">
      <h2 id={id} className="text-[13px] font-semibold tracking-tight">
        {children}
      </h2>
      {action}
    </div>
  );
}

function StatTile({
  icon: Icon,
  value,
  label,
  href,
  tone = "neutral",
}: {
  icon: LucideIcon;
  value: number;
  label: string;
  href?: string;
  tone?: "brand" | "neutral";
}) {
  const body = (
    <>
      <span
        className={cn(
          "grid size-8 place-items-center rounded-lg",
          tone === "brand" ? "bg-brand-soft text-brand" : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-4" strokeWidth={2} />
      </span>
      <span className="mt-3 block text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="block text-xs text-muted-foreground">{label}</span>
    </>
  );
  const cls = "block rounded-xl bg-card p-4 shadow-card transition-[box-shadow,transform]";
  return href ? (
    <Link href={href} className={cn(cls, "hover:-translate-y-px hover:shadow-float")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function PriorityRow({ thread, rank }: { thread: ScoredThread; rank: number }) {
  const { spaces, now } = useStore();
  const open = useOpenThread();
  const space = spaces.find((s) => s.id === thread.space);
  const last = thread.messages[thread.messages.length - 1];
  const why = whyLine(thread.reasons);

  return (
    <li className="group relative flex gap-4 px-5 py-4 transition-colors hover:bg-accent/40">
      <span className="hidden w-5 shrink-0 pt-2 text-center text-xs font-medium tabular-nums text-muted-foreground/70 sm:block">
        {rank}
      </span>
      <SenderAvatar name={last.from.name} email={last.from.email} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => open(thread)} className="block w-full text-left">
          <p className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-snug">
              {thread.subject || "(no subject)"}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relativeTime(last.sentAt, now)}</span>
          </p>
          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {thread.summary || thread.snippet}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
              <SpaceDot space={space} className="size-1.5" />
              {space?.name}
            </span>
            <span>{last.from.name}</span>
            {why && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand">{why}</span>
            )}
          </div>
        </button>
      </div>
      <ThreadActions
        thread={thread}
        compact
        className="absolute top-3 right-3 rounded-lg bg-card opacity-0 shadow-card transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
      />
    </li>
  );
}

function SpaceCard({ spaceId, threads }: { spaceId: string; threads: ScoredThread[] }) {
  const { spaces } = useStore();
  const open = useOpenThread();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return null;

  const inbox = threads.filter((t) => t.space === spaceId && t.status === "inbox");
  const needsReply = inbox.filter(
    (t) => t.category === "needs-reply" && t.reasons.some((r) => r.label === "Asks for a reply"),
  );
  const unread = inbox.filter((t) => t.unread);
  const top = [...inbox].filter((t) => !isLowValue(t)).sort((a, b) => b.score - a.score)[0];
  const outside = inbox.some((t) => t.reasons.some((r) => r.label === "Outside focus hours"));
  const status =
    needsReply.length > 0
      ? `${needsReply.length} to answer`
      : unread.length > 0
        ? `${unread.length} unread`
        : outside
          ? "Off hours"
          : "Quiet";

  return (
    <li className="flex flex-col rounded-xl bg-card p-4 shadow-card">
      <Link href={`/inbox/${space.id}`} className="group flex items-center gap-3">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4"
          style={{ backgroundColor: `color-mix(in oklch, ${space.color} 14%, transparent)` }}
        >
          <SpaceIcon space={space} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{space.name}</span>
          <span className="block text-xs text-muted-foreground">{status}</span>
        </span>
        <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </Link>
      {top ? (
        <button
          type="button"
          onClick={() => open(top)}
          className="mt-3 truncate rounded-lg bg-surface px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {top.subject}
        </button>
      ) : (
        <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-xs text-muted-foreground/70">Nothing pressing</p>
      )}
    </li>
  );
}

function Notice({ tone = "neutral", children }: { tone?: "neutral" | "danger"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl px-4 py-3 text-sm",
        tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-card text-muted-foreground shadow-card",
      )}
    >
      {tone === "danger" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />}
      <div>{children}</div>
    </div>
  );
}

export function Brief() {
  const store = useStore();
  const name = firstName(usePersonal().name);
  const open = useOpenThread();
  const { scored, spaces, now, ready } = store;
  const openSearch = useOpenSearch();

  // "/" searches from the brief too, as it does in the inbox.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      event.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  if (!ready) return <BriefSkeleton />;

  const inbox = scored.filter((t) => t.status === "inbox");
  const priorities = inbox
    .filter((t) => t.score >= PRIORITY_THRESHOLD && !isLowValue(t))
    .sort((a, b) => b.score - a.score);
  const top = priorities.slice(0, TOP_N);
  const pastSla = inbox.filter((t) => t.reasons.some((r) => r.label.startsWith("Past ")));
  const toAnswer = inbox.filter((t) => t.reasons.some((r) => r.label === "Asks for a reply"));
  const waiting = inbox
    .filter((t) => t.awaitingReply && t.reasons.every((r) => r.label !== "Asks for a reply"))
    .sort((a, b) => a.lastActivity - b.lastActivity);
  const noise = inbox.filter(isLowValue);
  const snoozedCount = scored.filter((t) => t.status === "snoozed").length;

  const syncing = store.accounts.some((a) => a.syncing) && store.threads.length === 0;
  const summary =
    store.accounts.length === 0
      ? "Connect a mailbox and the brief will fill itself."
      : syncing
        ? "Syncing your mailboxes."
        : priorities.length === 0
          ? "Nothing needs you right now."
          : `${plural(priorities.length, "thing")} ${priorities.length === 1 ? "needs" : "need"} you today.`;

  const clearNoise = () => {
    const snapshot = store.threads.filter((t) => noise.some((n) => n.id === t.id));
    store.clearThreads(noise.map((t) => t.id));
    toast.success(`Cleared ${plural(noise.length, "message")}`, {
      action: { label: "Undo", onClick: () => store.restoreThreads(snapshot) },
    });
  };

  const dateLabel = new Date(now).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="scroll-thin h-full overflow-y-auto overscroll-contain bg-surface">
      <div className="desktop-drag hidden h-8 in-[.desktop-app]:block" />
      <div className="mx-auto w-full max-w-4xl animate-fade-up space-y-10 px-6 py-10 md:px-10 md:py-14 in-[.desktop-app]:pt-6">
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">{dateLabel}</p>
            <SearchButton className="-my-1 max-md:hidden" />
          </div>
          <h1 className="font-display text-[2.6rem] leading-[1.05] tracking-tight md:text-5xl">
            {greeting(now)}
            {name && `, ${name}`}
            <span className="text-brand">.</span>
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            {summary}
            {pastSla.length > 0 && (
              <span className="text-foreground">
                {" "}
                {plural(pastSla.length, "thread")} {pastSla.length === 1 ? "is" : "are"} past your reply target.
              </span>
            )}
            {waiting.length > 0 && <> You&apos;re waiting on {plural(waiting.length, "reply", "replies")}.</>}
          </p>
          <SyncNote />
        </header>

        {(store.error ||
          store.accounts.length === 0 ||
          store.accounts.some((a) => a.syncError) ||
          store.accounts.some((a) => a.imapHost === "127.0.0.1" || a.imapHost === "localhost")) && (
          <div className="space-y-2">
            {store.error && <Notice tone="danger">{store.error}</Notice>}
            {store.accounts.length === 0 && (
              <Notice>
                Connect iCloud, Gmail or any IMAP mailbox in{" "}
                <Link href="/settings" className="font-medium text-brand hover:underline">
                  Settings
                </Link>
                . Each mailbox lands in a space.
              </Notice>
            )}
            {store.accounts.some((a) => a.imapHost === "127.0.0.1" || a.imapHost === "localhost") && (
              <Notice>This is a local test mailbox. Add your own accounts in Settings when you are ready.</Notice>
            )}
            {store.accounts.some((a) => a.syncError) && (
              <Notice tone="danger">
                {store.accounts
                  .filter((a) => a.syncError)
                  .map((a) => `${a.label}: ${a.syncError}`)
                  .join(" ")}
              </Notice>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile icon={Sparkles} value={priorities.length} label="Need you" href="/inbox/all" tone="brand" />
          <StatTile icon={MessageCircleReply} value={toAnswer.length} label="To answer" href="/inbox/all?tab=reply" />
          <StatTile icon={Hourglass} value={waiting.length} label="Waiting on others" />
          <StatTile icon={BellOff} value={noise.length} label="Can wait" href="/inbox/all?tab=noise" />
        </div>

        <section aria-labelledby="priorities">
          <SectionTitle
            id="priorities"
            action={
              priorities.length > TOP_N ? (
                <Link href="/inbox/all" className="text-xs font-medium text-brand hover:underline">
                  {priorities.length - TOP_N} more
                </Link>
              ) : null
            }
          >
            Today
          </SectionTitle>
          {top.length > 0 ? (
            <ol className="divide-y overflow-hidden rounded-2xl bg-card shadow-card">
              {top.map((t, i) => (
                <PriorityRow key={t.id} thread={t} rank={i + 1} />
              ))}
            </ol>
          ) : (
            <div className="flex items-center gap-4 rounded-2xl bg-card px-5 py-6 shadow-card">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success/12 text-success">
                <CheckCircle2 className="size-5" />
              </span>
              <div>
                <p className="text-sm font-medium">You&apos;re all caught up</p>
                <p className="text-xs text-muted-foreground">
                  Nothing above {PRIORITY_THRESHOLD}.
                  {snoozedCount > 0 && ` ${plural(snoozedCount, "snoozed thread")} will come back later.`}
                </p>
              </div>
            </div>
          )}
        </section>

        <section aria-labelledby="spaces">
          <SectionTitle id="spaces">Spaces</SectionTitle>
          <ul className="grid gap-3 sm:grid-cols-2">
            {spaces.map((s) => (
              <SpaceCard key={s.id} spaceId={s.id} threads={scored} />
            ))}
          </ul>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="waiting">
            <SectionTitle id="waiting">Waiting</SectionTitle>
            <div className="rounded-2xl bg-card p-2 shadow-card">
              {waiting.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">Nothing you are waiting on.</p>
              ) : (
                <ul>
                  {waiting.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => open(t)}
                        className="flex w-full items-baseline gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/60"
                      >
                        <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {relativeTime(t.lastActivity, now)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section aria-labelledby="noise">
            <SectionTitle id="noise">Can wait</SectionTitle>
            <div className="rounded-2xl bg-card p-4 shadow-card">
              {noise.length === 0 ? (
                <p className="text-sm text-muted-foreground">No newsletters or notifications.</p>
              ) : (
                <div className="space-y-4">
                  <ul className="space-y-2 text-sm">
                    {spaces.map((s) => {
                      const items = noise.filter((t) => t.space === s.id);
                      if (items.length === 0) return null;
                      const newsletters = items.filter((t) => t.category === "newsletter").length;
                      const notifications = items.length - newsletters;
                      return (
                        <li key={s.id} className="flex items-center gap-2">
                          <SpaceDot space={s} />
                          <span className="flex-1">{s.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {[
                              newsletters && plural(newsletters, "newsletter"),
                              notifications && plural(notifications, "notification"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={clearNoise}>
                      Clear {noise.length}
                    </Button>
                    <Button size="sm" variant="ghost" render={<Link href="/inbox/all?tab=noise" />} nativeButton={false}>
                      Review
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
