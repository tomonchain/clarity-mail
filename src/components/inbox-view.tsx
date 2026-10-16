"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Inbox, Search, Star } from "lucide-react";
import { InboxShortcuts } from "@/components/inbox-shortcuts";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SpaceDot } from "@/components/space-badge";
import { ThreadView } from "@/components/thread-view";
import { relativeTime } from "@/lib/format";
import { isLowValue, whyLine } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

export type InboxTab = "priority" | "recent" | "reply" | "noise" | "snoozed" | "done";

const TABS: { id: InboxTab; label: string }[] = [
  { id: "priority", label: "Priority" },
  { id: "recent", label: "Recent" },
  { id: "reply", label: "To answer" },
  { id: "noise", label: "Noise" },
  { id: "snoozed", label: "Snoozed" },
  { id: "done", label: "Done" },
];

const EMPTY: Record<InboxTab, string> = {
  priority: "Nothing important waiting. Check Noise if you're curious.",
  recent: "This inbox is empty.",
  reply: "No one is waiting on an answer from you.",
  noise: "No newsletters or notifications.",
  snoozed: "Nothing snoozed.",
  done: "Threads you mark as done land here.",
};

function filterThreads(threads: ScoredThread[], tab: InboxTab): ScoredThread[] {
  const inbox = threads.filter((t) => t.status === "inbox");
  const byTime = (a: ScoredThread, b: ScoredThread) => b.lastActivity - a.lastActivity;
  switch (tab) {
    case "priority":
      return inbox
        .filter((t) => !isLowValue(t))
        .sort((a, b) => b.score - a.score || byTime(a, b));
    case "recent":
      return inbox.sort(byTime);
    case "reply":
      return inbox
        .filter((t) => t.reasons.some((r) => r.label === "Asks for a reply"))
        .sort((a, b) => b.score - a.score);
    case "noise":
      return inbox.filter(isLowValue).sort(byTime);
    case "snoozed":
      return threads
        .filter((t) => t.status === "snoozed")
        .sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
    case "done":
      return threads.filter((t) => t.status === "done").sort(byTime);
  }
}

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => true,
  );
}

function ThreadRow({
  thread,
  selected,
  showSpace,
  onSelect,
}: {
  thread: ScoredThread;
  selected: boolean;
  showSpace: boolean;
  onSelect: () => void;
}) {
  const { spaces, now } = useStore();
  const last = thread.messages[thread.messages.length - 1];
  const space = spaces.find((s) => s.id === thread.space);
  const mine = new Set([thread.account.email, ...thread.account.aliases].map((address) => address.toLowerCase()));
  const fromMe = mine.has(last.from.email.toLowerCase());
  const other = [...thread.messages].reverse().find((message) => !mine.has(message.from.email.toLowerCase()));
  const sender = fromMe ? `You → ${other?.from.name ?? "them"}` : last.from.name;

  return (
    <li>
      <button
        type="button"
        data-thread-id={thread.id}
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          "flex w-full flex-col gap-0.5 px-5 py-3.5 text-left transition-colors",
          selected ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.03]",
        )}
      >
        <div className="flex items-center gap-2 text-sm">
          {thread.unread && <span className="size-1 shrink-0 rounded-full bg-foreground" aria-label="Unread" />}
          {showSpace && <SpaceDot space={space} />}
          <span className={cn("min-w-0 flex-1 truncate", thread.unread ? "font-semibold" : "font-medium")}>
            {sender}
          </span>
          {thread.starred && <Star className="size-3 fill-foreground text-foreground" />}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {thread.status === "snoozed" && thread.snoozedUntil
              ? `until ${new Date(thread.snoozedUntil).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
              : relativeTime(thread.lastActivity, now)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm text-muted-foreground", thread.unread && "text-foreground")}>
            {thread.subject}
          </span>
        </div>
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {whyLine(thread.reasons) ?? thread.snippet}
        </p>
      </button>
    </li>
  );
}

export function InboxView({ spaceId, initialTab }: { spaceId: string; initialTab?: InboxTab }) {
  const store = useStore();
  const { ready, scored, spaces, selectedId, select, setUnread } = store;
  const [tab, setTab] = useState<InboxTab>(initialTab ?? "priority");
  const [query, setQuery] = useState("");
  const isDesktop = useIsDesktop();
  const searchRef = useRef<HTMLInputElement>(null);
  const openedId = useRef<string | null>(null);

  const space = spaces.find((s) => s.id === spaceId);
  const inSpace = useMemo(
    () => (spaceId === "all" ? scored : scored.filter((t) => t.space === spaceId)),
    [scored, spaceId],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = filterThreads(inSpace, tab);
    if (!q) return list;
    return list.filter((t) =>
      [t.subject, t.snippet, ...t.messages.map((m) => `${m.from.name} ${m.from.email} ${m.body}`)]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [inSpace, tab, query]);

  const selected = inSpace.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected?.id) {
      openedId.current = null;
      return;
    }
    if (openedId.current === selected.id) return;
    openedId.current = selected.id;
    if (selected.unread) setUnread(selected.id, false);
  }, [selected, setUnread]);

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const counts = useMemo(() => {
    const c = {} as Record<InboxTab, number>;
    for (const t of TABS) c[t.id] = filterThreads(inSpace, t.id).length;
    return c;
  }, [inSpace]);

  const title = spaceId === "all" ? "All inboxes" : (space?.name ?? "Inbox");
  const subtitle = spaceId === "all" ? "Every account, every space" : space?.description;

  if (ready && spaceId !== "all" && !space) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <Inbox className="size-10 text-muted-foreground/40" />
        <p className="font-medium">This space doesn&apos;t exist anymore.</p>
        <Link href="/inbox/all" className="text-sm text-muted-foreground underline underline-offset-4">
          Go to All inboxes
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <section className="flex h-full min-h-0 w-full min-w-0 flex-col border-r border-border/80 lg:w-[22rem] lg:shrink-0">
        <div className="shrink-0 space-y-4 px-5 pt-8 pb-3">
          <div className="flex items-center gap-2">
            {space && <SpaceDot space={space} className="size-1.5" />}
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-medium tracking-tight">{title}</h1>
              {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            </div>
            <InboxShortcuts
              visible={visible}
              selected={selected}
              query={query}
              setQuery={setQuery}
              searchRef={searchRef}
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              className="pl-8"
              aria-label="Search"
            />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5" role="tablist" aria-label="Inbox filters">
            {TABS.map((t) => {
              const selected = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "text-xs",
                    selected
                      ? "text-foreground underline decoration-foreground/80 underline-offset-[5px]"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {ready && counts[t.id] > 0 && (
                    <span className="ml-1 tabular-nums text-muted-foreground">{counts[t.id]}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!ready ? (
            <div className="space-y-4 p-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
              <Inbox className="size-8 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                {query ? `No results for “${query}”.` : EMPTY[tab]}
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {visible.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  selected={t.id === selectedId}
                  showSpace={spaceId === "all"}
                  onSelect={() => select(t.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {isDesktop ? (
        <section className="hidden h-full min-h-0 min-w-0 flex-1 overflow-hidden lg:flex lg:flex-col">
          {selected ? (
            <ThreadView thread={selected} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Inbox className="size-10 text-muted-foreground/40" />
              <p className="text-sm">Pick a conversation to read it here.</p>
            </div>
          )}
        </section>
      ) : (
        <Sheet open={selected !== null} onOpenChange={(o) => !o && select(null)}>
          <SheetContent side="right" className="w-full! max-w-none! gap-0 overflow-hidden p-0">
            <SheetTitle className="sr-only">{selected?.subject ?? "Conversation"}</SheetTitle>
            {selected && <ThreadView thread={selected} />}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
