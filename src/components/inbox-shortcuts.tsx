"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SpaceDot } from "@/components/space-badge";
import { useThreadCommands } from "@/components/thread-actions";
import { INBOX_FILTERS, type InboxTab } from "@/lib/folders";
import { snoozeOptions } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";

const KEY_GROUPS: { title: string; keys: [string[], string][] }[] = [
  {
    title: "Move around",
    keys: [
      [["j", "↓"], "Next conversation"],
      [["k", "↑"], "Previous conversation"],
      [["Enter"], "Open"],
      [["Esc"], "Clear selection, search, or close"],
      [["/"], "Search"],
      [["1–4"], "Priority, Recent, To answer, Noise"],
    ],
  },
  {
    title: "Select",
    keys: [
      [["x"], "Select or unselect"],
      [["⇧", "j / k"], "Extend the selection"],
      [["⌘", "A"], "Select all"],
      [["*", "u"], "Select unread"],
      [["*", "n"], "Select none"],
    ],
  },
  {
    title: "Act on the selection",
    keys: [
      [["e"], "Archive"],
      [["#", "⌫"], "Delete"],
      [["!"], "Report spam / not spam"],
      [["z"], "Snooze until tomorrow"],
      [["⇧", "Z"], "Snooze until…"],
      [["v"], "Move to a space"],
      [["s"], "Star"],
      [["u"], "Mark read / unread"],
      [["⌘", "Z"], "Undo"],
    ],
  },
  {
    title: "Go to",
    keys: [
      [["g", "i"], "Inbox"],
      [["g", "s"], "Starred"],
      [["g", "z"], "Snoozed"],
      [["g", "t"], "Sent"],
      [["g", "e"], "Archive"],
      [["g", "#"], "Trash"],
      [["g", "!"], "Spam"],
    ],
  },
  {
    title: "Write",
    keys: [
      [["c"], "New message"],
      [["r"], "Reply"],
      [["f"], "Forward"],
      [["⌘", "↵"], "Send"],
    ],
  },
];

/** `g` then a key: the key that sends mail somewhere also goes there. */
const GO_TO: Record<string, InboxTab | null> = {
  i: null,
  s: "starred",
  z: "snoozed",
  t: "sent",
  e: "done",
  "#": "trash",
  "!": "spam",
};

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

/** A dialog or menu is open: keys belong to it, not to the inbox. */
function overlayOpen() {
  return Boolean(document.querySelector('[data-slot="dialog-content"], [role="menu"], [role="alertdialog"]'));
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 bg-surface px-1.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export type Picker = "snooze" | "move" | null;

/** A short list picked with the number keys: snooze times, or spaces. */
function KeyPicker({
  title,
  description,
  options,
  onClose,
}: {
  title: string;
  description: string;
  options: { label: string; detail?: string; dot?: ReactNode; onPick: () => void }[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="gap-3 sm:max-w-sm"
        onKeyDown={(event) => {
          const n = Number(event.key);
          if (!Number.isInteger(n) || n < 1 || n > options.length) return;
          event.preventDefault();
          options[n - 1].onPick();
          onClose();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ul className="space-y-0.5">
          {options.map((option, i) => (
            <li key={option.label}>
              <button
                type="button"
                autoFocus={i === 0}
                onClick={() => {
                  option.onPick();
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent"
              >
                <Kbd>{String(i + 1)}</Kbd>
                {option.dot}
                <span className="flex-1">{option.label}</span>
                {option.detail && <span className="text-xs text-muted-foreground">{option.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function PurgeManyDialog({ threads, onClose }: { threads: ScoredThread[]; onClose: () => void }) {
  const { purgeThreads } = useStore();
  const one = threads.length === 1;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {one ? "Delete this conversation forever?" : `Delete ${threads.length} conversations forever?`}
          </DialogTitle>
          <DialogDescription>
            {one ? `“${threads[0].subject || "(no subject)"}” is` : "They are"} erased from the server. This can’t be
            undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            autoFocus
            onClick={() => {
              purgeThreads(threads.slice(0, 200).map((t) => t.id));
              toast(one ? "Deleted forever" : `${threads.length} conversations deleted forever`, {
                description: one ? threads[0].subject : undefined,
              });
              onClose();
            }}
          >
            Delete forever
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function InboxShortcuts({
  visible,
  selected,
  checked,
  setChecked,
  query,
  setQuery,
  searchRef,
  tabsShown,
  setTab,
  spaceId,
  accountId,
  picker,
  setPicker,
}: {
  visible: ScoredThread[];
  selected: ScoredThread | null;
  /** The threads ticked with x, in list order. */
  checked: ScoredThread[];
  setChecked: Dispatch<SetStateAction<Set<string>>>;
  query: string;
  setQuery: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  tabsShown: boolean;
  setTab: (tab: InboxTab) => void;
  spaceId: string;
  accountId?: string;
  picker: Picker;
  setPicker: (picker: Picker) => void;
}) {
  const router = useRouter();
  const { select, now, spaces } = useStore();
  const { archive, trash, spam, toInbox, snooze, forward, move, star, markRead, undo } = useThreadCommands();
  const [help, setHelp] = useState(false);
  const [purging, setPurging] = useState<ScoredThread[] | null>(null);
  // The first key of a two-key shortcut (g i, * a), shown until the second one comes.
  const [prefix, setPrefix] = useState<"g" | "*" | null>(null);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What an action applies to: the ticked threads, or else the open one.
  const targets = useMemo(() => (checked.length > 0 ? checked : selected ? [selected] : []), [checked, selected]);

  useEffect(() => {
    const startPrefix = (key: "g" | "*") => {
      setPrefix(key);
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
      prefixTimer.current = setTimeout(() => setPrefix(null), 1500);
    };
    const endPrefix = () => {
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
      setPrefix(null);
    };
    const goTo = (tab: InboxTab | null) => {
      const params = new URLSearchParams();
      if (tab) params.set("tab", tab);
      if (accountId) params.set("account", accountId);
      const search = params.toString();
      router.push(`/inbox/${spaceId}${search ? `?${search}` : ""}`);
    };
    /** After acting on ticked threads, the selection is spent. */
    const done = () => {
      if (checked.length > 0) setChecked(new Set());
    };

    const onKey = (event: KeyboardEvent) => {
      const typing = isTyping(event.target);

      if (event.metaKey || event.ctrlKey) {
        if (typing || help || overlayOpen() || event.altKey || event.shiftKey) return;
        const key = event.key.toLowerCase();
        if (key === "a" && visible.length > 0) {
          event.preventDefault();
          setChecked(new Set(visible.map((t) => t.id)));
        } else if (key === "z") {
          event.preventDefault();
          undo();
        }
        return;
      }

      if (event.key === "Escape") {
        if (typing) {
          (event.target as HTMLElement).blur();
          return;
        }
        if (help || overlayOpen()) return;
        if (prefix) {
          endPrefix();
          return;
        }
        if (checked.length > 0) {
          event.preventDefault();
          setChecked(new Set());
          return;
        }
        if (query) {
          event.preventDefault();
          setQuery("");
          return;
        }
        select(null);
        return;
      }

      if (typing || help || overlayOpen() || event.altKey) return;

      if (prefix === "g") {
        endPrefix();
        if (event.key in GO_TO) {
          event.preventDefault();
          goTo(GO_TO[event.key]);
        }
        return;
      }
      if (prefix === "*") {
        endPrefix();
        const pick: Record<string, (t: ScoredThread) => boolean> = {
          a: () => true,
          u: (t) => t.unread,
          r: (t) => !t.unread,
          s: (t) => t.starred,
        };
        if (event.key === "n") {
          event.preventDefault();
          setChecked(new Set());
        } else if (pick[event.key]) {
          event.preventDefault();
          setChecked(new Set(visible.filter(pick[event.key]).map((t) => t.id)));
        }
        return;
      }

      const index = selected ? visible.findIndex((thread) => thread.id === selected.id) : -1;
      const step = (delta: 1 | -1) => {
        if (visible.length === 0) return;
        event.preventDefault();
        const next =
          index < 0
            ? delta > 0
              ? 0
              : visible.length - 1
            : Math.min(visible.length - 1, Math.max(0, index + delta));
        const item = visible[next];
        // Shift extends the selection over the rows it passes, like in a file list.
        if (event.shiftKey) {
          setChecked((current) => {
            const ids = new Set(current);
            if (index >= 0) ids.add(visible[index].id);
            ids.add(item.id);
            return ids;
          });
        }
        select(item.id);
      };

      switch (event.key) {
        case "j":
        case "J":
        case "ArrowDown":
          step(1);
          return;
        case "k":
        case "K":
        case "ArrowUp":
          step(-1);
          return;
        case "Enter":
        case "o":
          if (index < 0 && visible[0]) {
            event.preventDefault();
            select(visible[0].id);
          }
          return;
        case "?":
          event.preventDefault();
          setHelp(true);
          return;
        case "/":
          event.preventDefault();
          searchRef.current?.focus();
          searchRef.current?.select();
          return;
        case "g":
        case "*":
          event.preventDefault();
          startPrefix(event.key);
          return;
        case "x": {
          const item = selected && index >= 0 ? selected : visible[0];
          if (!item) return;
          event.preventDefault();
          if (!selected || index < 0) select(item.id);
          setChecked((current) => {
            const ids = new Set(current);
            if (ids.has(item.id)) ids.delete(item.id);
            else ids.add(item.id);
            return ids;
          });
          return;
        }
      }

      if (tabsShown && /^[1-9]$/.test(event.key)) {
        const filter = INBOX_FILTERS[Number(event.key) - 1];
        if (!filter) return;
        event.preventDefault();
        setTab(filter.id);
        return;
      }

      if (targets.length === 0) return;

      switch (event.key) {
        case "e": {
          const list = targets.filter((t) => t.status !== "done");
          if (list.length === 0) return;
          event.preventDefault();
          archive(list);
          done();
          return;
        }
        case "#":
        case "Delete":
        case "Backspace": {
          event.preventDefault();
          const inTrash = targets.filter((t) => t.status === "trash");
          if (inTrash.length === targets.length) {
            setPurging(inTrash);
            return;
          }
          trash(targets.filter((t) => t.status !== "trash"));
          done();
          return;
        }
        case "!": {
          event.preventDefault();
          if (targets.every((t) => t.status === "spam")) toInbox(targets);
          else spam(targets.filter((t) => t.status !== "spam"));
          done();
          return;
        }
        case "s":
          event.preventDefault();
          star(targets);
          return;
        case "u":
          event.preventDefault();
          markRead(targets);
          return;
        case "I":
          event.preventDefault();
          markRead(targets, false);
          return;
        case "U":
          event.preventDefault();
          markRead(targets, true);
          return;
        case "z": {
          const list = targets.filter((t) => t.status === "inbox");
          const option = snoozeOptions(now).find((item) => item.label === "Tomorrow morning");
          if (list.length === 0 || !option) return;
          event.preventDefault();
          snooze(list, option.label, option.until);
          done();
          return;
        }
        case "Z":
          if (!targets.some((t) => t.status === "inbox")) return;
          event.preventDefault();
          setPicker("snooze");
          return;
        case "v":
          event.preventDefault();
          setPicker("move");
          return;
        case "r":
          if (!selected) return;
          event.preventDefault();
          document.getElementById("reply-body")?.focus();
          return;
        case "f":
          if (!selected) return;
          event.preventDefault();
          forward(selected);
          return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visible,
    selected,
    checked,
    setChecked,
    targets,
    query,
    setQuery,
    searchRef,
    tabsShown,
    setTab,
    spaceId,
    accountId,
    setPicker,
    help,
    prefix,
    router,
    select,
    archive,
    trash,
    spam,
    toInbox,
    snooze,
    forward,
    star,
    markRead,
    undo,
    now,
  ]);

  useEffect(() => () => {
    if (prefixTimer.current) clearTimeout(prefixTimer.current);
  }, []);

  const clearAfter = () => {
    if (checked.length > 0) setChecked(new Set());
  };
  const count = targets.length === 1 ? "this conversation" : `${targets.length} conversations`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" size="icon-sm" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)} />
          }
        >
          <Keyboard />
        </TooltipTrigger>
        <TooltipContent>Shortcuts (?)</TooltipContent>
      </Tooltip>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Tick conversations with x, then act on all of them at once. Without a selection, keys act on the open
              conversation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {KEY_GROUPS.map((group) => (
              <section key={group.title} className="space-y-2">
                <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
                  {group.title}
                </h3>
                <ul className="space-y-2 text-sm">
                  {group.keys.map(([keys, label]) => (
                    <li key={label} className="flex items-center justify-between gap-3">
                      <span>{label}</span>
                      <span className="flex shrink-0 gap-1">
                        {keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {prefix && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-3 py-1.5 text-xs text-background shadow-card">
          <kbd className="font-mono">{prefix}</kbd>
          <span className="opacity-70">
            {prefix === "g" ? "i inbox · s starred · z snoozed · t sent · e archive · # trash · ! spam" : "a all · u unread · r read · s starred · n none"}
          </span>
        </div>
      )}
      {picker === "snooze" && (
        <KeyPicker
          title="Snooze until"
          description={`For ${count}.`}
          onClose={() => setPicker(null)}
          options={snoozeOptions(now).map((o) => ({
            label: o.label,
            detail: new Date(o.until).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
            onPick: () => {
              snooze(
                targets.filter((t) => t.status === "inbox"),
                o.label,
                o.until,
              );
              clearAfter();
            },
          }))}
        />
      )}
      {picker === "move" && (
        <KeyPicker
          title="Move to space"
          description={`For ${count}.`}
          onClose={() => setPicker(null)}
          options={spaces.map((s) => ({
            label: s.name,
            dot: <SpaceDot space={s} />,
            onPick: () => {
              move(targets, s.id);
              clearAfter();
            },
          }))}
        />
      )}
      {purging && (
        <PurgeManyDialog
          threads={purging}
          onClose={() => {
            setPurging(null);
            clearAfter();
          }}
        />
      )}
    </>
  );
}
