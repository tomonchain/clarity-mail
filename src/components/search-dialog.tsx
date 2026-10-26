"use client";

import { createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, SearchX, Sparkles } from "lucide-react";
import { SenderAvatar } from "@/components/sender-avatar";
import { SpaceDot } from "@/components/space-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDisplayPrefs } from "@/lib/display";
import { plural, relativeTime } from "@/lib/format";
import { previewOf } from "@/lib/preview";
import { matchesSearch } from "@/lib/search";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

const SearchContext = createContext<() => void>(() => {});

/** Opens the search over all mail, from anywhere but Settings. */
export const useOpenSearch = () => useContext(SearchContext);

export function useOpenThread() {
  const router = useRouter();
  const { select } = useStore();
  return (t: ScoredThread) => {
    select(t.id);
    // Archived or snoozed mail opens in its folder, so the list around it makes sense.
    router.push(`/inbox/${t.space}${t.status === "inbox" ? "" : `?tab=${t.status}`}`);
  };
}

const STATUS_LABELS: Partial<Record<ScoredThread["status"], string>> = { done: "Archived", snoozed: "Snoozed" };
const RESULT_LIMIT = 50;

function ResultRow({ thread, active, onOpen, onHover }: { thread: ScoredThread; active: boolean; onOpen: () => void; onHover: () => void }) {
  const { spaces, now } = useStore();
  const prefs = useDisplayPrefs();
  const space = spaces.find((s) => s.id === thread.space);
  const last = thread.messages[thread.messages.length - 1];
  const status = STATUS_LABELS[thread.status];
  const preview = previewOf(thread, prefs.preview);

  return (
    <li role="option" aria-selected={active} data-active={active || undefined}>
      <button
        type="button"
        tabIndex={-1}
        onClick={onOpen}
        onMouseMove={onHover}
        className={cn("flex w-full gap-3 rounded-xl px-3 py-2.5 text-left", active && "bg-accent")}
      >
        <SenderAvatar name={last.from.name} email={last.from.email} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm", thread.unread ? "font-semibold" : "font-medium")}>
              {last.from.name}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{relativeTime(thread.lastActivity, now)}</span>
          </span>
          <span className="block truncate text-[13px]">{thread.subject || "(no subject)"}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {space && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
                <SpaceDot space={space} className="size-1.5" />
                {space.name}
              </span>
            )}
            {status && <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px]">{status}</span>}
            {preview.ai && <Sparkles className="size-3 shrink-0 text-brand" aria-label="Summary" />}
            <span className="min-w-0 truncate">{preview.text}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function SearchPanel({ onClose }: { onClose: () => void }) {
  const { scored } = useStore();
  const open = useOpenThread();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const list = useRef<HTMLUListElement>(null);
  const q = deferred.trim().toLowerCase();

  // Trash and spam aside, every space and folder.
  const matches = useMemo(
    () =>
      q
        ? scored
            .filter((t) => t.status !== "trash" && t.status !== "spam" && matchesSearch(t, q))
            .sort((a, b) => b.lastActivity - a.lastActivity)
        : [],
    [scored, q],
  );
  const shown = matches.slice(0, RESULT_LIMIT);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  useEffect(() => {
    list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [current, shown.length]);

  const choose = (t: ScoredThread | undefined) => {
    if (!t) return;
    onClose();
    open(t);
  };

  return (
    <div className="flex max-h-[min(36rem,80dvh)] min-h-0 flex-col">
      <div className="relative shrink-0 border-b">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
              e.preventDefault();
              setActive(Math.min(current + 1, shown.length - 1));
            } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
              e.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(shown[current]);
            }
          }}
          placeholder="Search all mail"
          aria-label="Search all mail"
          role="combobox"
          aria-controls="search-results"
          aria-expanded={shown.length > 0}
          className="h-13 w-full bg-transparent pr-14 pl-11 text-[15px] outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 rounded border bg-surface px-1.5 font-mono text-[10px] text-muted-foreground">
          Esc
        </kbd>
      </div>
      {!q ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">
          Names, addresses, subjects and words in the mail, across every space.
        </p>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
          <SearchX className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Nothing matches “{deferred.trim()}”</p>
          <p className="text-xs text-muted-foreground">Try another name, word or address.</p>
        </div>
      ) : (
        <>
          <ul ref={list} id="search-results" role="listbox" aria-label="Results" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
            {shown.map((t, i) => (
              <ResultRow
                key={t.id}
                thread={t}
                active={i === current}
                onOpen={() => choose(t)}
                onHover={() => setActive(i)}
              />
            ))}
          </ul>
          <p className="shrink-0 border-t px-4 py-2 text-[11px] text-muted-foreground">
            {matches.length > RESULT_LIMIT
              ? `${RESULT_LIMIT} most recent of ${matches.length} results`
              : plural(matches.length, "result")}{" "}
            · <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd> to move, <kbd className="font-mono">↵</kbd> to open
          </p>
        </>
      )}
    </div>
  );
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const allowed = !pathname?.startsWith("/settings");
  const openSearch = useCallback(() => {
    if (allowed) setOpen(true);
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed]);

  return (
    <SearchContext.Provider value={openSearch}>
      {children}
      <Dialog open={open && allowed} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[12dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Search all mail</DialogTitle>
          {/* Mounted only while open: each search starts empty. */}
          {open && <SearchPanel onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </SearchContext.Provider>
  );
}

/** The magnifier at the top right of a page. */
export function SearchButton({ className }: { className?: string }) {
  const openSearch = useOpenSearch();
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Search all mail" onClick={openSearch} className={className} />}
      >
        <Search />
      </TooltipTrigger>
      <TooltipContent>
        Search all mail <kbd className="ml-1 rounded bg-background/20 px-1 font-mono text-[10px]">⌘K</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
