"use client";

import { useEffect, useState, type RefObject } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useThreadCommands } from "@/components/thread-actions";
import { snoozeOptions } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";

const KEYS: [string, string][] = [
  ["j / ↓", "Next conversation"],
  ["k / ↑", "Previous conversation"],
  ["Enter", "Open"],
  ["Esc", "Close, or clear search"],
  ["e", "Mark done"],
  ["s", "Star"],
  ["u", "Toggle unread"],
  ["r", "Reply"],
  ["z", "Snooze until tomorrow morning"],
  ["/", "Search"],
  ["?", "Show these shortcuts"],
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
  const { done, snooze } = useThreadCommands();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = isTyping(event.target);

      if (event.key === "Escape") {
        if (typing) {
          (event.target as HTMLElement).blur();
          return;
        }
        if (help) return;
        if (query) {
          event.preventDefault();
          setQuery("");
          return;
        }
        select(null);
        return;
      }

      if (typing || help) return;

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

      if (event.key === "e" && selected.status === "inbox") {
        event.preventDefault();
        const neighbor = visible[index + 1] ?? visible[index - 1] ?? null;
        done(selected);
        select(neighbor?.id ?? null);
        return;
      }
      if (event.key === "s") {
        event.preventDefault();
        toggleStar(selected.id);
        return;
      }
      if (event.key === "u") {
        event.preventDefault();
        setUnread(selected.id, !selected.unread);
        return;
      }
      if (event.key === "r") {
        event.preventDefault();
        document.getElementById("reply-body")?.focus();
        return;
      }
      if (event.key === "z" && selected.status === "inbox") {
        const option = snoozeOptions(now).find((item) => item.label === "Tomorrow morning");
        if (!option) return;
        event.preventDefault();
        const neighbor = visible[index + 1] ?? visible[index - 1] ?? null;
        snooze(selected, option.label, option.until);
        select(neighbor?.id ?? null);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selected, query, setQuery, searchRef, help, select, setUnread, toggleStar, done, snooze, now]);

  return (
    <>
      <button
        type="button"
        onClick={() => setHelp(true)}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
      >
        Shortcuts
      </button>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>These work in the inbox, unless you are typing.</DialogDescription>
          </DialogHeader>
          <dl className="grid grid-cols-[7.5rem_1fr] gap-y-2 text-sm">
            {KEYS.map(([key, label]) => (
              <div key={key} className="contents">
                <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
