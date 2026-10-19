"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Archive,
  BellOff,
  CheckCircle2,
  Inbox,
  MailOpen,
  MessageCircleReply,
  Search,
  SearchX,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { InboxShortcuts } from "@/components/inbox-shortcuts";
import { SenderAvatar } from "@/components/sender-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpaceDot } from "@/components/space-badge";
import { useThreadCommands } from "@/components/thread-actions";
import { ThreadView } from "@/components/thread-view";
import { toast } from "sonner";
import { sentByMe } from "@/lib/drafts";
import { folderOf, INBOX_FILTERS, type InboxFilter, type InboxTab } from "@/lib/folders";
import { relativeTime } from "@/lib/format";
import { isLowValue, PRIORITY_THRESHOLD, whyLine } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

export type { InboxTab } from "@/lib/folders";

const EMPTY: Record<InboxFilter, { icon: LucideIcon; title: string; hint: string }> = {
  priority: { icon: CheckCircle2, title: "You're all caught up", hint: "Nothing important waiting. Check Noise if you're curious." },
  recent: { icon: Inbox, title: "This inbox is empty", hint: "New mail shows up here as soon as it syncs." },
  reply: { icon: MessageCircleReply, title: "No one is waiting on you", hint: "Conversations that ask for an answer land here." },
  noise: { icon: BellOff, title: "No noise", hint: "Newsletters and notifications are filed here." },
};

function emptyFor(tab: InboxTab) {
  const folder = folderOf(tab);
  if (folder) return { icon: folder.icon, title: folder.empty, hint: folder.hint };
  return EMPTY[tab as InboxFilter];
}

function filterThreads(threads: ScoredThread[], tab: InboxTab): ScoredThread[] {
  const inbox = threads.filter((t) => t.status === "inbox");
  const byTime = (a: ScoredThread, b: ScoredThread) => b.lastActivity - a.lastActivity;
  const kept = (t: ScoredThread) => t.status !== "trash" && t.status !== "spam";
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
    case "starred":
      return threads.filter((t) => t.starred && kept(t)).sort(byTime);
    case "snoozed":
      return threads
        .filter((t) => t.status === "snoozed")
        .sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
    case "sent":
      return threads.filter((t) => kept(t) && sentByMe(t)).sort(byTime);
    case "done":
    case "spam":
    case "trash":
      return threads.filter((t) => t.status === tab).sort(byTime);
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

function RowActions({ thread }: { thread: ScoredThread }) {
  const { toggleStar } = useStore();
  const { archive, trash, toInbox } = useThreadCommands();
  const isInbox = thread.status === "inbox";
  const button =
    "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-[15px]";
  return (
    <div className="pointer-events-none absolute top-2 right-2 flex items-center gap-0.5 rounded-lg bg-card p-0.5 opacity-0 shadow-card transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 max-lg:hidden">
      {isInbox ? (
        <button type="button" className={button} aria-label="Archive" title="Archive (e)" onClick={() => archive(thread)}>
          <Archive />
        </button>
      ) : (
        <button type="button" className={button} aria-label="Move to inbox" title="Move to inbox" onClick={() => toInbox(thread)}>
          <Inbox />
        </button>
      )}
      {thread.status !== "trash" && (
        <button type="button" className={button} aria-label="Delete" title="Delete (#)" onClick={() => trash(thread)}>
          <Trash2 />
        </button>
      )}
      <button
        type="button"
        className={button}
        aria-label={thread.starred ? "Unstar" : "Star"}
        title={thread.starred ? "Unstar (s)" : "Star (s)"}
        onClick={() => toggleStar(thread.id)}
      >
        <Star className={cn(thread.starred && "fill-warning text-warning")} />
      </button>
    </div>
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
  const face = fromMe ? (other?.from ?? last.from) : last.from;
  const why = whyLine(thread.reasons);
  const count = thread.messages.length;

  return (
    <li className="group/row relative">
      <button
        type="button"
        data-thread-id={thread.id}
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          "group relative flex w-full gap-3 rounded-xl py-3 pr-3 pl-4 text-left transition-colors",
          selected ? "bg-brand-soft" : "hover:bg-accent/70",
        )}
      >
        {thread.unread && (
          <span className="absolute top-[1.4rem] left-1.5 size-2 rounded-full bg-brand" aria-label="Unread" />
        )}
        <SenderAvatar name={face.name} email={face.email} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13.5px]",
                thread.unread ? "font-semibold text-foreground" : "font-medium text-foreground/85",
              )}
            >
              {sender}
              {count > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
            </span>
            {thread.starred && <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label="Starred" />}
            <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
              {thread.status === "snoozed" && thread.snoozedUntil
                ? `until ${new Date(thread.snoozedUntil).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                : relativeTime(thread.lastActivity, now)}
            </span>
          </div>
          <span
            className={cn(
              "truncate text-[13px]",
              thread.unread ? "font-medium text-foreground" : "text-foreground/75",
            )}
          >
            {thread.subject || "(no subject)"}
          </span>
          <p className="line-clamp-1 text-[12.5px] leading-snug text-muted-foreground">{thread.snippet}</p>
          {(why || (showSpace && space)) && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {showSpace && space && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                  <SpaceDot space={space} className="size-1.5" />
                  {space.name}
                </span>
              )}
              {why && (
                <span
                  className={cn(
                    "min-w-0 truncate rounded-full px-2 py-0.5 text-[11px]",
                    thread.score >= PRIORITY_THRESHOLD
                      ? "bg-brand-soft font-medium text-brand"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  {why}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
      <RowActions thread={thread} />
    </li>
  );
}

function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex animate-fade-up flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground">
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

export function InboxView({
  spaceId,
  initialTab,
  accountId,
}: {
  spaceId: string;
  initialTab?: InboxTab;
  accountId?: string;
}) {
  const store = useStore();
  const { ready, scored, spaces, accounts, selectedId, select, setUnread } = store;
  const [tab, setTab] = useState<InboxTab>(initialTab ?? "priority");
  const [query, setQuery] = useState("");
  const [emptying, setEmptying] = useState(false);
  const isDesktop = useIsDesktop();
  const searchRef = useRef<HTMLInputElement>(null);
  const openedId = useRef<string | null>(null);

  const space = spaces.find((s) => s.id === spaceId);
  const account = accountId ? accounts.find((a) => a.id === accountId) : undefined;
  const folder = folderOf(tab);
  const inSpace = useMemo(
    () =>
      scored.filter(
        (t) => (spaceId === "all" || t.space === spaceId) && (!accountId || t.accountId === accountId),
      ),
    [scored, spaceId, accountId],
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

  // When the open conversation leaves this view (archived, deleted, snoozed, moved…),
  // open the next one in the list, like a mail app does.
  const shown = useRef<{ id: string; status: string; ids: string[]; index: number } | null>(null);
  useEffect(() => {
    const prev = shown.current;
    const index = selectedId ? visible.findIndex((t) => t.id === selectedId) : -1;
    if (index >= 0 && selected) {
      shown.current = { id: selected.id, status: selected.status, ids: visible.map((t) => t.id), index };
      return;
    }
    shown.current = null;
    if (!prev || prev.id !== selectedId) return;
    const current = inSpace.find((t) => t.id === selectedId);
    if (current && current.status === prev.status) return;
    if (!isDesktop) {
      select(null);
      return;
    }
    const stillShown = new Set(visible.map((t) => t.id));
    const next =
      prev.ids.slice(prev.index + 1).find((id) => stillShown.has(id)) ??
      prev.ids.slice(0, prev.index).reverse().find((id) => stillShown.has(id)) ??
      null;
    select(next);
  }, [visible, selectedId, selected, inSpace, isDesktop, select]);

  const counts = useMemo(() => {
    const c = {} as Record<InboxFilter, number>;
    for (const t of INBOX_FILTERS) c[t.id] = filterThreads(inSpace, t.id).length;
    return c;
  }, [inSpace]);

  const scope = account ? account.label : spaceId === "all" ? "All inboxes" : (space?.name ?? "Inbox");
  const title = folder ? folder.label : scope;
  const subtitle = folder
    ? spaceId === "all" && !account
      ? "Every mailbox"
      : scope
    : account
      ? account.email
      : spaceId === "all"
        ? "Every account, every space"
        : space?.description;
  const unreadCount = inSpace.filter((t) => t.status === "inbox" && t.unread).length;
  const empty = emptyFor(tab);
  const purgeable = folder && (folder.id === "trash" || folder.id === "spam") ? visible : [];
  const TitleIcon = folder?.icon;

  if (ready && spaceId !== "all" && !space) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <EmptyState icon={Inbox} title="This space doesn't exist anymore." />
        <Link href="/inbox/all" className="text-sm font-medium text-brand hover:underline">
          Go to All inboxes
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <section className="flex h-full min-h-0 w-full min-w-0 flex-col border-r bg-background lg:w-[24rem] lg:shrink-0 xl:w-[26rem]">
        <div className="desktop-drag shrink-0 space-y-3.5 px-4 pt-6 pb-3 in-[.desktop-app]:pt-10">
          <div className="flex items-start gap-2 px-1">
            <div className="min-w-0 flex-1">
              <h1 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight">
                {TitleIcon ? (
                  <TitleIcon className="size-[18px] text-muted-foreground" strokeWidth={1.9} />
                ) : (
                  space && !account && <SpaceDot space={space} />
                )}
                {title}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {ready && !folder && unreadCount > 0 ? `${unreadCount} unread · ` : ""}
                {ready && folder && visible.length > 0 ? `${visible.length} · ` : ""}
                {subtitle}
              </p>
            </div>
            {purgeable.length > 0 && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setEmptying(true)}
                    />
                  }
                >
                  Empty
                </TooltipTrigger>
                <TooltipContent>Delete everything in {folder?.label} forever</TooltipContent>
              </Tooltip>
            )}
            <InboxShortcuts
              visible={visible}
              selected={selected}
              query={query}
              setQuery={setQuery}
              searchRef={searchRef}
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}`}
              className="peer h-9 border-transparent bg-secondary pr-9 pl-9 shadow-none focus-visible:bg-card dark:bg-secondary"
              aria-label="Search"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded border bg-card px-1.5 font-mono text-[10px] text-muted-foreground peer-focus-visible:hidden">
              /
            </kbd>
          </div>
          {!folder && (
          <div
            className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]"
            role="tablist"
            aria-label="Inbox filters"
          >
            {INBOX_FILTERS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-soft"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t.label}
                  {ready && counts[t.id] > 0 && (
                    <span className={cn("tabular-nums", active ? "text-primary-foreground/65" : "text-muted-foreground/70")}>
                      {counts[t.id]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          )}
        </div>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
          {!ready ? (
            <div className="space-y-1 px-2 pt-1">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex gap-3 py-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3.5 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            query ? (
              <EmptyState icon={SearchX} title={`No results for “${query}”`} hint="Try another name, word or address." />
            ) : (
              <EmptyState icon={empty.icon} title={empty.title} hint={empty.hint} />
            )
          ) : (
            <ul className="space-y-0.5">
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
        <section className="hidden h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-surface lg:flex lg:flex-col">
          {selected ? (
            <ThreadView thread={selected} />
          ) : (
            <div className="desktop-drag flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <span className="grid size-16 place-items-center rounded-2xl bg-card text-muted-foreground shadow-card">
                <MailOpen className="size-7" strokeWidth={1.5} />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-medium">Select a conversation</p>
                <p className="text-xs text-muted-foreground">
                  Use <kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd> to move, <kbd className="font-mono">?</kbd> for
                  all shortcuts
                </p>
              </div>
            </div>
          )}
        </section>
      ) : (
        <Sheet open={selected !== null} onOpenChange={(o) => !o && select(null)}>
          <SheetContent side="right" className="w-full! max-w-none! gap-0 overflow-hidden bg-surface p-0">
            <SheetTitle className="sr-only">{selected?.subject ?? "Conversation"}</SheetTitle>
            {selected && <ThreadView thread={selected} />}
          </SheetContent>
        </Sheet>
      )}

      <Dialog open={emptying} onOpenChange={setEmptying}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Empty {folder?.label}?</DialogTitle>
            <DialogDescription>
              {purgeable.length === 1 ? "1 conversation is" : `${purgeable.length} conversations are`} erased from
              the server for good. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEmptying(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const ids = purgeable.slice(0, 200).map((t) => t.id);
                store.purgeThreads(ids);
                toast(`${ids.length === 1 ? "1 conversation" : `${ids.length} conversations`} deleted forever`);
                setEmptying(false);
              }}
            >
              Delete forever
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
