"use client";

import { useSyncExternalStore } from "react";
import type { UpdateInfo } from "@/app/api/updates/route";
import { APP_VERSION, compareVersions } from "@/lib/releases";

export type { UpdateInfo };

/** The last answer from /api/updates, shared by Settings and the sidebar; asked once per session. */
let info: UpdateInfo | null = null;
let checking = false;
let asked = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export async function checkForUpdates(force = false) {
  if (checking) return;
  checking = true;
  emit();
  try {
    const res = await fetch(`/api/updates${force ? "?force=1" : ""}`, { cache: "no-store" });
    if (res.ok) info = (await res.json()) as UpdateInfo;
    else info = { current: APP_VERSION, checkedAt: Date.now(), latest: null, error: "unreachable" };
  } catch {
    info = { current: APP_VERSION, checkedAt: Date.now(), latest: null, error: "unreachable" };
  } finally {
    checking = false;
    emit();
  }
}

type State = { info: UpdateInfo | null; checking: boolean };
let snapshot: State = { info, checking };
const SERVER: State = { info: null, checking: false };

function read(): State {
  if (snapshot.info !== info || snapshot.checking !== checking) snapshot = { info, checking };
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!asked) {
    asked = true;
    void checkForUpdates();
  }
  return () => listeners.delete(listener);
}

export function useUpdates(): State & { available: boolean } {
  const state = useSyncExternalStore(subscribe, read, () => SERVER);
  const latest = state.info?.latest;
  return { ...state, available: Boolean(latest && compareVersions(latest.version, APP_VERSION) > 0) };
}

const SEEN_KEY = "clarity:seen-version";

/**
 * The version this device ran last time, then remembers this one. Null on a first run,
 * so a new install isn't told it was "updated".
 */
export function takePreviousVersion(): string | null {
  try {
    const seen = window.localStorage.getItem(SEEN_KEY);
    if (seen !== APP_VERSION) window.localStorage.setItem(SEEN_KEY, APP_VERSION);
    return seen;
  } catch {
    return null;
  }
}
