"use client";

import { useSyncExternalStore } from "react";

/**
 * How the mail list looks. Stored on this device only.
 * - preview: a summary of each conversation, or the start of its text.
 * - layout: list and reading pane side by side, or the list alone with
 *   conversations opening full screen, as in Spark.
 * - senderPhotos: look up a picture for senders (Gravatar, then the company's icon).
 */
export type DisplayPrefs = { preview: "summary" | "text"; layout: "split" | "full"; senderPhotos: boolean };

const KEY = "clarity:display";
const DEFAULT: DisplayPrefs = { preview: "summary", layout: "split", senderPhotos: true };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: DisplayPrefs = DEFAULT;
let unsaved: DisplayPrefs | null = null;

function read(): DisplayPrefs {
  if (typeof window === "undefined") return DEFAULT;
  if (unsaved) return unsaved;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return DEFAULT;
  }
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<DisplayPrefs>) : {};
    cached = {
      preview: parsed.preview === "text" ? "text" : "summary",
      layout: parsed.layout === "full" ? "full" : "split",
      senderPhotos: parsed.senderPhotos !== false,
    };
  } catch {
    cached = DEFAULT;
  }
  return cached;
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

export function useDisplayPrefs(): DisplayPrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

export function setDisplayPref<K extends keyof DisplayPrefs>(key: K, value: DisplayPrefs[K]) {
  const next = { ...read(), [key]: value };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
    unsaved = null;
  } catch {
    // Private mode or full storage: the choice lasts until reload.
    unsaved = next;
  }
  for (const listener of listeners) listener();
}
