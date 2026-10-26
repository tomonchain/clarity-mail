"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  Archive,
  ArrowDownUp,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  FolderInput,
  Inbox,
  Mail,
  MailOpen,
  ShieldAlert,
  X,
  MessageCircleReply,
  Search,
  SearchX,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { InboxShortcuts, type Picker } from "@/components/inbox-shortcuts";
import { SearchButton } from "@/components/search-dialog";
import { SenderAvatar } from "@/components/sender-avatar";
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
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpaceDot } from "@/components/space-badge";
import { useThreadCommands } from "@/components/thread-actions";
import { ThreadView } from "@/components/thread-view";
import { toast } from "sonner";
import { useDisplayPrefs } from "@/lib/display";
import { sentByMe } from "@/lib/drafts";
import { folderOf, INBOX_FILTERS, type InboxFilter, type InboxTab } from "@/lib/folders";
import { relativeTime } from "@/lib/format";
import { previewOf } from "@/lib/preview";
import { isLowValue, PRIORITY_THRESHOLD, whyLine } from "@/lib/priority";
import { matchesSearch } from "@/lib/search";
import { setSortOrder, SORT_ORDERS, sortThreads, useSortOrder, type SortOrder } from "@/lib/sort";
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
  checked,
  selecting,
  showSpace,
  onSelect,
  onToggle,
}: {
  thread: ScoredThread;
  selected: boolean;
  checked: boolean;
  /** Some row is ticked: every row shows its box, so the list reads as a selection. */
  selecting: boolean;
  showSpace: boolean;
  onSelect: () => void;
  onToggle: (range: boolean) => void;
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
  const prefs = useDisplayPrefs();
  const preview = previewOf(thread, prefs.preview);

  return (
    <li className="group/row relative">
      <button
        type="button"
        data-thread-id={thread.id}
        onClick={(event) => {
          // ⌘-click or ⇧-click ticks rows instead of opening them, as in Finder.
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            onToggle(event.shiftKey);
            return;
          }
          onSelect();
        }}
        aria-current={selected}
        className={cn(
          "group relative flex w-full gap-3 rounded-xl py-3 pr-3 pl-4 text-left transition-colors select-none",
          checked
            ? "bg-brand-soft/70 ring-1 ring-brand/25 ring-inset"
            : selected
              ? "bg-brand-soft"
              : "hover:bg-accent/70",
          // While ticking, the cursor row needs to stand out from the ticked ones.
          selected && selecting && "ring-2 ring-brand/70 ring-inset",
        )}
      >
        {thread.unread && (
          <span className="absolute top-[1.4rem] left-1.5 size-2 rounded-full bg-brand" aria-label="Unread" />
        )}
        <span className={cn("transition-opacity", (checked || selecting) && "opacity-0", "max-lg:opacity-100 lg:group-hover/row:opacity-0")}>
          <SenderAvatar name={face.name} email={face.email} />
        </span>
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
          <p
            className={cn(
              "text-[12.5px] leading-snug text-muted-foreground",
              // A summary gets two lines: cut after one it rarely says anything.
              preview.text === thread.snippet ? "line-clamp-1" : "line-clamp-2",
            )}
          >
            {preview.ai && <Sparkles className="mr-1 inline size-3 -translate-y-px text-brand" aria-label="Summary" />}
            {preview.text}
          </p>
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
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={checked ? "Unselect" : "Select"}
        title="Select (x)"
        onClick={(event) => onToggle(event.shiftKey)}
        className={cn(
          "absolute top-3 left-4 grid size-9 place-items-center rounded-full transition-opacity max-lg:hidden",
          checked || selecting ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      >
        <span
          className={cn(
            "grid size-[18px] place-items-center rounded-[5px] border-[1.5px] transition-colors",
            checked ? "border-brand bg-brand text-white" : "border-muted-foreground/45 bg-card hover:border-foreground/60",
          )}
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {!selecting && <RowActions thread={thread} />}
    </li>
  );
}

type BulkButton = { label: string; keys: string; icon: LucideIcon; run: () => void; destructive?: boolean };

/** The actions offered for ticked threads, the same ones the keys trigger. */
function useBulkButtons(threads: ScoredThread[], clear: () => void, setPicker: (picker: Picker) => void): BulkButton[] {
  const { archive, trash, spam, toInbox, star, markRead } = useThreadCommands();
  const then = (fn: () => void) => () => {
    fn();
    clear();
  };
  const inInbox = threads.filter((t) => t.status === "inbox");
  const allTrash = threads.every((t) => t.status === "trash");
  const allSpam = threads.every((t) => t.status === "spam");
  const buttons: BulkButton[] = [];
  if (allTrash || allSpam) {
    buttons.push({ label: allSpam ? "Not spam" : "Restore", keys: allSpam ? "!" : "", icon: Inbox, run: then(() => toInbox(threads)) });
  } else if (threads.some((t) => t.status !== "done")) {
    buttons.push({ label: "Archive", keys: "e", icon: Archive, run: then(() => archive(threads.filter((t) => t.status !== "done"))) });
  } else {
    buttons.push({ label: "Move to inbox", keys: "", icon: Inbox, run: then(() => toInbox(threads)) });
  }
  if (!allTrash) {
    buttons.push({
      label: "Delete",
      keys: "#",
      icon: Trash2,
      destructive: true,
      run: then(() => trash(threads.filter((t) => t.status !== "trash"))),
    });
  }
  if (!allSpam && !allTrash) {
    buttons.push({ label: "Spam", keys: "!", icon: ShieldAlert, run: then(() => spam(threads.filter((t) => t.status !== "spam"))) });
  }
  if (inInbox.length > 0) buttons.push({ label: "Snooze", keys: "⇧Z", icon: Clock, run: () => setPicker("snooze") });
  buttons.push({ label: "Move", keys: "v", icon: FolderInput, run: () => setPicker("move") });
  const anyUnstarred = threads.some((t) => !t.starred);
  buttons.push({ label: anyUnstarred ? "Star" : "Unstar", keys: "s", icon: Star, run: () => star(threads) });
  const anyUnread = threads.some((t) => t.unread);
  buttons.push({
    label: anyUnread ? "Mark read" : "Mark unread",
    keys: "u",
    icon: anyUnread ? MailOpen : Mail,
    run: () => markRead(threads),
  });
  return buttons;
}

/** Above the list while threads are ticked: how many, select all, and the actions. */
function SelectionBar({
  threads,
  total,
  onAll,
  onClear,
  setPicker,
}: {
  threads: ScoredThread[];
  total: number;
  onAll: () => void;
  onClear: () => void;
  setPicker: (picker: Picker) => void;
}) {
  const buttons = useBulkButtons(threads, onClear, setPicker);
  const all = threads.length === total;
  return (
    <div className="pointer-events-auto flex w-full max-w-[24rem] animate-fade-up items-center gap-1 rounded-2xl border bg-card/95 px-1.5 py-1 shadow-lg backdrop-blur">
      <Tooltip>
        <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={onClear} />}>
          <X />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Clear <kbd className="ml-1 rounded bg-background/20 px-1 font-mono text-[10px]">Esc</kbd>
        </TooltipContent>
      </Tooltip>
      <span className="text-[13px] font-medium tabular-nums">{threads.length}</span>
      {!all && (
        <button type="button" onClick={onAll} className="ml-1 text-xs text-brand hover:underline">
          All {total}
        </button>
      )}
      <span className="ml-auto flex items-center">
        {buttons.map((b) => (
          <Tooltip key={b.label}>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={b.label}
                  onClick={b.run}
                  className={cn(b.destructive && "hover:text-destructive")}
                />
              }
            >
              <b.icon />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {b.label}
              {b.keys && <kbd className="ml-1 rounded bg-background/20 px-1 font-mono text-[10px]">{b.keys}</kbd>}
            </TooltipContent>
          </Tooltip>
        ))}
      </span>
    </div>
  );
}

/** In the reading pane while threads are ticked: what is selected and what the keys do. */
function SelectionPanel({
  threads,
  onClear,
  setPicker,
}: {
  threads: ScoredThread[];
  onClear: () => void;
  setPicker: (picker: Picker) => void;
}) {
  const buttons = useBulkButtons(threads, onClear, setPicker);
  const senders = [...new Set(threads.map((t) => t.messages[t.messages.length - 1].from.name))];
  return (
    <div className="desktop-drag flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="space-y-1.5">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {threads.length === 1 ? "1 conversation" : `${threads.length} conversations`}
        </p>
        <p className="mx-auto max-w-sm truncate text-sm text-muted-foreground">
          {senders.slice(0, 3).join(", ")}
          {senders.length > 3 ? ` and ${senders.length - 3} more` : ""}
        </p>
      </div>
      <div className="grid w-full max-w-sm grid-cols-2 gap-2">
        {buttons.map((b) => (
          <Button
            key={b.label}
            variant="outline"
            onClick={b.run}
            className={cn("justify-start gap-2.5 bg-card", b.destructive && "hover:text-destructive")}
          >
            <b.icon />
            <span className="flex-1 text-left">{b.label}</span>
            {b.keys && <kbd className="font-mono text-[11px] text-muted-foreground">{b.keys}</kbd>}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        <kbd className="font-mono">x</kbd> to tick more · <kbd className="font-mono">⌘Z</kbd> to undo ·{" "}
        <button type="button" onClick={onClear} className="hover:text-foreground">
          <kbd className="font-mono">Esc</kbd> to clear
        </button>
      </p>
    </div>
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
  const [tab, setTabState] = useState<InboxTab>(initialTab ?? "priority");
  // Threads ticked with x (or ⌘/⇧-click), and the row a ⇧-click range starts from.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [query, setQuery] = useState("");
  const [emptying, setEmptying] = useState(false);
  const sortOrder = useSortOrder();
  const { layout } = useDisplayPrefs();
  const isDesktop = useIsDesktop();
  // Spark-style: the list alone, and a conversation opens over it, full width.
  const full = isDesktop && layout === "full";
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

  // Typing stays responsive on a big mailbox: the list filters a beat behind the input.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    const list = sortThreads(filterThreads(inSpace, tab), sortOrder);
    if (!q) return list;
    return list.filter((t) => matchesSearch(t, q));
  }, [inSpace, tab, deferredQuery, sortOrder]);

  const selected = inSpace.find((t) => t.id === selectedId) ?? null;
  // Only what the list shows counts: a ticked thread that was archived or filtered out drops out.
  const checked = useMemo(() => visible.filter((t) => checkedIds.has(t.id)), [visible, checkedIds]);
  const clearChecked = useCallback(() => setCheckedIds(new Set()), []);
  const setTab = useCallback((next: InboxTab) => {
    setTabState(next);
    setCheckedIds(new Set());
  }, []);
  const toggle = (id: string, range: boolean) => {
    setCheckedIds((current) => {
      const ids = new Set(current);
      const from = anchor.current ? visible.findIndex((t) => t.id === anchor.current) : -1;
      const to = visible.findIndex((t) => t.id === id);
      if (range && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        for (const t of visible.slice(a, b + 1)) ids.add(t.id);
      } else if (ids.has(id)) ids.delete(id);
      else ids.add(id);
      return ids;
    });
    anchor.current = id;
  };

  // While several threads are ticked the reading pane shows the selection, so moving
  // the cursor over a thread does not mean it was read.
  const reading = !(isDesktop && checked.length > 1);
  useEffect(() => {
    if (!selected?.id || !reading) {
      openedId.current = null;
      return;
    }
    if (openedId.current === selected.id) return;
    openedId.current = selected.id;
    if (selected.unread) setUnread(selected.id, false);
  }, [selected, reading, setUnread]);

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
    <div className="relative flex h-full min-h-0 overflow-hidden">
      <section
        className={cn(
          "relative flex h-full min-h-0 w-full min-w-0 flex-col bg-background",
          !full && "border-r lg:w-[24rem] lg:shrink-0 xl:w-[26rem]",
        )}
      >
        <div
          className={cn(
            "desktop-drag shrink-0 space-y-3.5 px-4 pt-6 pb-3 in-[.desktop-app]:pt-10",
            full && "mx-auto w-full max-w-5xl lg:px-8",
          )}
        >
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
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Sort"
                          className={cn(sortOrder !== "smart" && "text-brand hover:text-brand")}
                        />
                      }
                    />
                  }
                >
                  <ArrowDownUp />
                </TooltipTrigger>
                <TooltipContent>
                  Sort: {SORT_ORDERS.find((o) => o.id === sortOrder)?.label}
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={sortOrder} onValueChange={(value) => setSortOrder(value as SortOrder)}>
                    {SORT_ORDERS.map((o) => (
                      <DropdownMenuRadioItem key={o.id} value={o.id}>
                        {o.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <SearchButton />
            <InboxShortcuts
              visible={visible}
              selected={selected}
              checked={checked}
              setChecked={setCheckedIds}
              query={query}
              setQuery={setQuery}
              searchRef={searchRef}
              tabsShown={!folder}
              setTab={setTab}
              spaceId={spaceId}
              accountId={accountId}
              picker={picker}
              setPicker={setPicker}
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

        <div
          className={cn(
            "scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3",
            full && "lg:px-6 [&>*]:mx-auto [&>*]:max-w-5xl",
            // Room under the last row so the floating bar never hides it.
            checked.length > 0 && "pb-20",
          )}
        >
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
                  checked={checkedIds.has(t.id)}
                  selecting={checked.length > 0}
                  showSpace={spaceId === "all"}
                  onSelect={() => select(t.id)}
                  onToggle={(range) => toggle(t.id, range)}
                />
              ))}
            </ul>
          )}
        </div>
        {checked.length > 0 && (
          // Floats over the list instead of pushing it down, so nothing moves on the first tick.
          <div className="pointer-events-none absolute inset-x-3 bottom-4 z-10 flex justify-center">
            <SelectionBar
              threads={checked}
              total={visible.length}
              onAll={() => setCheckedIds(new Set(visible.map((t) => t.id)))}
              onClear={clearChecked}
              setPicker={setPicker}
            />
          </div>
        )}
      </section>

      {full ? (
        // Over the list rather than instead of it, so the list keeps its scroll for the way back.
        selected &&
        checked.length <= 1 && (
          <section className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-hidden bg-surface">
            <ThreadView thread={selected} onBack={() => select(null)} />
          </section>
        )
      ) : isDesktop ? (
        <section className="hidden h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-surface lg:flex lg:flex-col">
          {checked.length > 1 ? (
            <SelectionPanel threads={checked} onClear={clearChecked} setPicker={setPicker} />
          ) : selected ? (
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
