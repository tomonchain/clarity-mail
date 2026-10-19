"use client";

import { useSyncExternalStore } from "react";

/**
 * Remote images in mail tell the sender when, where and how often a message
 * was opened. They load by default, like in Apple Mail; the owner can block
 * them in Settings → Security and then load them per mail or per sender.
 * Stored on this device only.
 */
export type ImagePrefs = { mode: "ask" | "always"; trusted: string[] };

// v2: images load by default. The first version saved "ask" with every trusted sender.
const KEY = "clarity:remote-images:v2";
const LEGACY_KEY = "clarity:remote-images";
const DEFAULT: ImagePrefs = { mode: "always", trusted: [] };
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cached: ImagePrefs = DEFAULT;

function read(): ImagePrefs {
  if (typeof window === "undefined") return DEFAULT;
  let raw: string | null = null;
  let legacy = false;
  try {
    raw = window.localStorage.getItem(KEY);
    if (raw === null) {
      raw = window.localStorage.getItem(LEGACY_KEY);
      legacy = raw !== null;
    }
  } catch {
    return DEFAULT;
  }
  const stamp = raw === null ? null : `${legacy ? "1" : "2"}${raw}`;
  if (stamp === cachedRaw) return cached;
  cachedRaw = stamp;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<ImagePrefs>) : {};
    cached = {
      mode: legacy ? DEFAULT.mode : parsed.mode === "ask" ? "ask" : "always",
      trusted: Array.isArray(parsed.trusted) ? parsed.trusted.filter((s): s is string => typeof s === "string") : [],
    };
  } catch {
    cached = DEFAULT;
  }
  return cached;
}

function write(next: ImagePrefs) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the choice lasts until reload.
    cachedRaw = undefined;
    cached = next;
  }
  for (const listener of listeners) listener();
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

export function useImagePrefs(): ImagePrefs {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

export function setImageMode(mode: ImagePrefs["mode"]) {
  write({ ...read(), mode });
}

export function trustSender(email: string) {
  const address = email.trim().toLowerCase();
  if (!address) return;
  const prefs = read();
  if (prefs.trusted.includes(address)) return;
  write({ ...prefs, trusted: [...prefs.trusted, address] });
}

export function forgetTrustedSenders() {
  write({ ...read(), trusted: [] });
}

export function imagesAllowed(prefs: ImagePrefs, sender?: string) {
  return prefs.mode === "always" || Boolean(sender && prefs.trusted.includes(sender.toLowerCase()));
}
