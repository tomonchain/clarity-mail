"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { SpaceDot } from "@/components/space-badge";
import { ThreadActions } from "@/components/thread-actions";
import { greeting, plural, relativeTime } from "@/lib/format";
import { isLowValue, PRIORITY_THRESHOLD, whyLine } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";

const TOP_N = 5;

function BriefSkeleton() {
  return (
    <div className="mx-auto h-full w-full max-w-xl space-y-8 overflow-y-auto px-6 py-16">
      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

function SyncNote() {
  const { accounts, now, revision } = useStore();
  if (accounts.length === 0) return null;
  const syncing = accounts.some((a) => a.syncing);
  const last = accounts.reduce((max, a) => Math.max(max, a.lastSyncAt ?? 0), 0);
  const when = !last ? "Waiting for the first sync" : syncing ? "Syncing mailboxes" : syncedLabel(last, now);
  return (
    <p className="text-xs text-muted-foreground">
      {when}. Your phone and Mac read this same copy{revision > 0 ? ` · ${revision}` : ""}.
    </p>
  );
}

function syncedLabel(ts: number, now: number) {
  const label = relativeTime(ts, now);
  if (label === "now") return "Synced just now";
  if (/^\d+[mhd]$/.test(label)) return `Synced ${label} ago`;
  return `Synced ${label}`;
}

function useOpenThread() {
  const router = useRouter();
  const { select } = useStore();
  return (t: ScoredThread) => {
    select(t.id);
    router.push(`/inbox/${t.space}`);
  };
}

function PriorityRow({ thread, rank }: { thread: ScoredThread; rank: number }) {
  const { spaces, now } = useStore();
  const open = useOpenThread();
  const space = spaces.find((s) => s.id === thread.space);
  const last = thread.messages[thread.messages.length - 1];
  const why = whyLine(thread.reasons);

  return (
    <li className="border-t border-border/80 py-6 first:border-t-0">
      <div className="flex gap-4">
        <span className="w-4 shrink-0 pt-1 text-xs tabular-nums text-muted-foreground">{rank}</span>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => open(thread)} className="block w-full text-left">
            <p className="text-[15px] leading-snug">{thread.subject}</p>
            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {thread.summary || thread.snippet}
            </p>
            {why && <p className="mt-1.5 text-xs text-foreground/80">{why}</p>}
            <p className="mt-2 text-xs text-muted-foreground">
              <SpaceDot space={space} className="mr-1.5 size-1.5 translate-y-px" />
              {space?.name}
              <span className="px-1.5">·</span>
              {last.from.name}
              <span className="px-1.5">·</span>
              {relativeTime(last.sentAt, now)}
            </p>
          </button>
          <div className="mt-2">
            <ThreadActions thread={thread} compact />
          </div>
        </div>
      </div>
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

  return (
    <li className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 border-t border-border/80 py-3 sm:grid-cols-[8.5rem_1fr_auto]">
      <Link href={`/inbox/${space.id}`} className="flex items-center gap-2 text-sm">
        <SpaceDot space={space} className="size-1.5" />
        {space.name}
      </Link>
      {top ? (
        <button type="button" onClick={() => open(top)} className="truncate text-left text-sm text-muted-foreground">
          {top.subject}
        </button>
      ) : (
        <span className="text-sm text-muted-foreground" aria-label="Quiet">
          —
        </span>
      )}
      <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-auto sm:text-right">
        {needsReply.length > 0 ? `${needsReply.length} to answer` : unread.length > 0 ? `${unread.length} unread` : outside ? "Off hours" : ""}
      </span>
    </li>
  );
}

export function Brief() {
  const store = useStore();
  const open = useOpenThread();
  const { scored, spaces, now, ready } = store;

  if (!ready) return <BriefSkeleton />;

  const inbox = scored.filter((t) => t.status === "inbox");
  const priorities = inbox
    .filter((t) => t.score >= PRIORITY_THRESHOLD && !isLowValue(t))
    .sort((a, b) => b.score - a.score);
  const top = priorities.slice(0, TOP_N);
  const pastSla = inbox.filter((t) => t.reasons.some((r) => r.label.startsWith("Past ")));
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
    <div className="mx-auto h-full w-full max-w-xl space-y-14 overflow-y-auto overscroll-contain px-6 py-12 md:py-16">
      {store.error && (
        <p className="text-sm text-destructive">{store.error}</p>
      )}

      <header className="space-y-3">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{dateLabel}</p>
        <h1 className="text-[1.75rem] font-medium tracking-tight">{greeting(now)}.</h1>
        <SyncNote />
        <p className="text-sm leading-relaxed text-muted-foreground">
          {summary}
          {pastSla.length > 0 && (
            <span className="text-foreground">
              {" "}
              {plural(pastSla.length, "thread")} {pastSla.length === 1 ? "is" : "are"} past your
              reply target.
            </span>
          )}
          {waiting.length > 0 && <> You&apos;re waiting on {plural(waiting.length, "reply", "replies")}.</>}
        </p>
      </header>

      {store.accounts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Connect iCloud or OVH in{" "}
          <Link href="/settings" className="text-foreground underline underline-offset-4">
            Settings
          </Link>
          . Each mailbox lands in a space.
        </p>
      )}
      {store.accounts.some((a) => a.imapHost === "127.0.0.1" || a.imapHost === "localhost") && (
        <p className="text-sm text-muted-foreground">
          This is a local test mailbox. Add iCloud or OVH in Settings when you want your own mail.
        </p>
      )}
      {store.accounts.some((a) => a.syncError) && (
        <p className="text-sm text-destructive">
          {store.accounts
            .filter((a) => a.syncError)
            .map((a) => `${a.label}: ${a.syncError}`)
            .join(" ")}
        </p>
      )}

      <section aria-labelledby="priorities">
        <h2 id="priorities" className="text-xs tracking-wide text-muted-foreground uppercase">
          Today
        </h2>
        {top.length > 0 ? (
          <ol className="mt-2">
            {top.map((t, i) => (
              <PriorityRow key={t.id} thread={t} rank={i + 1} />
            ))}
          </ol>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Nothing above {PRIORITY_THRESHOLD}.
            {snoozedCount > 0 && ` ${plural(snoozedCount, "snoozed thread")} will come back later.`}
          </p>
        )}
        {priorities.length > TOP_N && (
          <Link href="/inbox/all" className="mt-4 inline-block text-sm text-muted-foreground underline underline-offset-4">
            {priorities.length - TOP_N} more
          </Link>
        )}
      </section>

      <section aria-labelledby="spaces">
        <h2 id="spaces" className="text-xs tracking-wide text-muted-foreground uppercase">
          Spaces
        </h2>
        <ul className="mt-2">
          {spaces.map((s) => (
            <SpaceCard key={s.id} spaceId={s.id} threads={scored} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="waiting">
        <h2 id="waiting" className="text-xs tracking-wide text-muted-foreground uppercase">
          Waiting
        </h2>
        {waiting.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing you are waiting on.</p>
        ) : (
          <ul className="mt-2">
            {waiting.map((t) => (
              <li key={t.id} className="border-t border-border/80 py-3 first:border-t-0">
                <button type="button" onClick={() => open(t)} className="flex w-full items-baseline gap-3 text-left text-sm">
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(t.lastActivity, now)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="noise">
        <h2 id="noise" className="text-xs tracking-wide text-muted-foreground uppercase">
          Can wait
        </h2>
        {noise.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No newsletters or notifications.</p>
        ) : (
          <div className="mt-3 space-y-3">
            <ul className="space-y-1.5 text-sm">
              {spaces.map((s) => {
                const items = noise.filter((t) => t.space === s.id);
                if (items.length === 0) return null;
                const newsletters = items.filter((t) => t.category === "newsletter").length;
                const notifications = items.length - newsletters;
                return (
                  <li key={s.id} className="flex items-baseline gap-2">
                    <SpaceDot space={s} className="size-1.5" />
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
            <div className="flex gap-4 text-sm">
              <button type="button" onClick={clearNoise} className="text-foreground underline underline-offset-4">
                Clear {noise.length}
              </button>
              <Link href="/inbox/all?tab=noise" className="text-muted-foreground underline underline-offset-4">
                Review
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
