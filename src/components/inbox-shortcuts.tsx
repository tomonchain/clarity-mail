"use client";

import { useEffect, useState, type RefObject } from "react";
import { Keyboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PurgeDialog, useThreadCommands } from "@/components/thread-actions";
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
      [["Esc"], "Close, or clear search"],
      [["/"], "Search"],
    ],
  },
  {
    title: "Triage",
    keys: [
      [["e"], "Archive"],
      [["#", "⌫"], "Delete"],
      [["!"], "Report spam / not spam"],
      [["z"], "Snooze until tomorrow"],
      [["s"], "Star"],
      [["u"], "Mark read / unread"],
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

export function InboxShortcuts({
  visible,
  selected,
  query,
  setQuery,
  searchRef,
}: {
  visible: ScoredThread[];
  selected: ScoredThread | null;
  query: string;
  setQuery: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const { select, setUnread, toggleStar, now } = useStore();
  const { archive, trash, spam, toInbox, snooze, forward } = useThreadCommands();
  const [help, setHelp] = useState(false);
  const [purging, setPurging] = useState<ScoredThread | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) return;
      const typing = isTyping(event.target);

      if (event.key === "Escape") {
        if (typing) {
          (event.target as HTMLElement).blur();
          return;
        }
        if (help || overlayOpen()) return;
        if (query) {
          event.preventDefault();
          setQuery("");
          return;
        }
        select(null);
        return;
      }

      if (typing || help || overlayOpen()) return;

      const index = selected ? visible.findIndex((thread) => thread.id === selected.id) : -1;
      const go = (nextIndex: number) => {
        const item = visible[nextIndex];
        if (!item) return;
        event.preventDefault();
        select(item.id);
      };

      if (event.key === "j" || event.key === "ArrowDown") {
        if (visible.length === 0) return;
        go(index < 0 ? 0 : Math.min(visible.length - 1, index + 1));
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        if (visible.length === 0) return;
        go(index < 0 ? visible.length - 1 : Math.max(0, index - 1));
        return;
      }
      if (event.key === "Enter") {
        if (index < 0 && visible[0]) {
          event.preventDefault();
          select(visible[0].id);
        }
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelp(true);
        return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (!selected) return;

      switch (event.key) {
        case "e":
          if (selected.status === "done") return;
          event.preventDefault();
          archive(selected);
          return;
        case "#":
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (selected.status === "trash") setPurging(selected);
          else trash(selected);
          return;
        case "!":
          event.preventDefault();
          if (selected.status === "spam") toInbox(selected);
          else spam(selected);
          return;
        case "s":
          event.preventDefault();
          toggleStar(selected.id);
          return;
        case "u":
          event.preventDefault();
          setUnread(selected.id, !selected.unread);
          return;
        case "r":
          event.preventDefault();
          document.getElementById("reply-body")?.focus();
          return;
        case "f":
          event.preventDefault();
          forward(selected);
          return;
        case "z": {
          if (selected.status !== "inbox") return;
          const option = snoozeOptions(now).find((item) => item.label === "Tomorrow morning");
          if (!option) return;
          event.preventDefault();
          snooze(selected, option.label, option.until);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    visible,
    selected,
    query,
    setQuery,
    searchRef,
    help,
    select,
    setUnread,
    toggleStar,
    archive,
    trash,
    spam,
    toInbox,
    snooze,
    forward,
    now,
  ]);

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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>These work in every mailbox view, unless you are typing.</DialogDescription>
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
      {purging && (
        <PurgeDialog thread={purging} open onOpenChange={(open) => !open && setPurging(null)} />
      )}
    </>
  );
}
