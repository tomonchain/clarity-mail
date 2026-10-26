"use client";

import { useSyncExternalStore } from "react";
import type { ScoredThread } from "@/lib/types";

/**
 * How the thread list is ordered. "smart" keeps each view's own order (score for
 * Priority, wake-up time for Snoozed, newest first elsewhere). Stored on this device only.
 */
export type SortOrder = "smart" | "newest" | "oldest" | "sender" | "subject" | "unread";

export const SORT_ORDERS: { id: SortOrder; label: string }[] = [
  { id: "smart", label: "Smart" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "unread", label: "Unread first" },
  { id: "sender", label: "Sender" },
  { id: "subject", label: "Subject" },
];

const KEY = "clarity:sort-order";
const listeners = new Set<() => void>();
let fallback: SortOrder = "smart";

function read(): SortOrder {
  if (typeof window === "undefined") return "smart";
  try {
    const raw = window.localStorage.getItem(KEY);
    return SORT_ORDERS.some((o) => o.id === raw) ? (raw as SortOrder) : "smart";
  } catch {
    return fallback;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSortOrder(): SortOrder {
  return useSyncExternalStore(subscribe, read, () => "smart");
}

export function setSortOrder(order: SortOrder) {
  try {
    window.localStorage.setItem(KEY, order);
  } catch {
    // Private mode or full storage: the choice lasts until reload.
    fallback = order;
  }
  for (const listener of listeners) listener();
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const senderOf = (t: ScoredThread) => t.messages[t.messages.length - 1]?.from.name || t.messages[t.messages.length - 1]?.from.email || "";
// Replies and forwards sort with the conversation they belong to.
const subjectOf = (t: ScoredThread) => t.subject.replace(/^\s*((re|fwd?|tr|aw)\s*:\s*)+/i, "");

/** Reorders a list that is already in the view's smart order; ties keep that order. */
export function sortThreads(threads: ScoredThread[], order: SortOrder): ScoredThread[] {
  const byTime = (a: ScoredThread, b: ScoredThread) => b.lastActivity - a.lastActivity;
  switch (order) {
    case "smart":
      return threads;
    case "newest":
      return [...threads].sort(byTime);
    case "oldest":
      return [...threads].sort((a, b) => a.lastActivity - b.lastActivity);
    case "unread":
      return [...threads].sort((a, b) => Number(b.unread) - Number(a.unread) || byTime(a, b));
    case "sender":
      return [...threads].sort((a, b) => collator.compare(senderOf(a), senderOf(b)) || byTime(a, b));
    case "subject":
      return [...threads].sort((a, b) => collator.compare(subjectOf(a), subjectOf(b)) || byTime(a, b));
  }
}
