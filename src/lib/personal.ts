"use client";

import { useSyncExternalStore } from "react";

/**
 * The owner's name for greetings and how the lock screen looks. Stored on this
 * device only: the lock screen shows before anything is unlocked, so it cannot
 * ask the server, and the server never hands the owner's name to a stranger.
 */
export type LockBackground = "photos" | "custom" | "plain";
export type Personal = { name: string; background: LockBackground; shift: number; custom: string | null };

const NAME_KEY = "clarity:owner-name";
const BACKGROUND_KEY = "clarity:lock-background";
const SHIFT_KEY = "clarity:lock-photo-shift";
// Separate key: a photo is a few hundred kilobytes and only the lock screen needs it.
const CUSTOM_KEY = "clarity:lock-photo";
const KEYS = [NAME_KEY, BACKGROUND_KEY, SHIFT_KEY, CUSTOM_KEY];

const DEFAULT: Personal = { name: "", background: "photos", shift: 0, custom: null };
const listeners = new Set<() => void>();
// What could not be saved (private mode, full storage) lasts until reload.
const unsaved = new Map<string, string | null>();
let cachedStamp: string | undefined;
let cached: Personal = DEFAULT;

function get(key: string): string | null {
  if (unsaved.has(key)) return unsaved.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function read(): Personal {
  if (typeof window === "undefined") return DEFAULT;
  const raw = KEYS.map(get);
  const stamp = JSON.stringify(raw);
  if (stamp === cachedStamp) return cached;
  cachedStamp = stamp;
  const [name, background, shift, custom] = raw;
  cached = {
    name: name?.trim() ?? "",
    background: background === "custom" || background === "plain" ? background : "photos",
    shift: Number(shift) || 0,
    custom: custom?.startsWith("data:image/") ? custom : null,
  };
  return cached;
}

/** Returns false when the browser refused to keep it, usually a photo too big for storage. */
function put(key: string, value: string | null): boolean {
  let saved = true;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    unsaved.delete(key);
  } catch {
    unsaved.set(key, value);
    saved = false;
  }
  for (const listener of listeners) listener();
  return saved;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || KEYS.includes(event.key)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePersonal(): Personal {
  return useSyncExternalStore(subscribe, read, () => DEFAULT);
}

/** First name only: "Good morning, Thomas", not "Good morning, Thomas Durand". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function setOwnerName(name: string) {
  put(NAME_KEY, name.trim() ? name.trim().slice(0, 60) : null);
}

export function setLockBackground(background: LockBackground) {
  put(BACKGROUND_KEY, background === "photos" ? null : background);
}

export function nextLockPhoto() {
  put(SHIFT_KEY, String(read().shift + 1));
}

export function setCustomPhoto(dataUrl: string | null): boolean {
  const saved = put(CUSTOM_KEY, dataUrl);
  if (dataUrl && saved) put(BACKGROUND_KEY, "custom");
  if (!dataUrl && read().background === "custom") put(BACKGROUND_KEY, null);
  return saved;
}

/**
 * Free landscape photos from Unsplash, served by Picsum (no key, no tracking cookie).
 * Hand-picked so a random pick never lands on a laptop or a coffee cup.
 */
const PHOTOS = [
  { id: 10, author: "Paul Jarvis" },
  { id: 11, author: "Paul Jarvis" },
  { id: 13, author: "Paul Jarvis" },
  { id: 15, author: "Paul Jarvis" },
  { id: 16, author: "Paul Jarvis" },
  { id: 17, author: "Paul Jarvis" },
  { id: 28, author: "Jerry Adney" },
  { id: 29, author: "Go Wild" },
  { id: 46, author: "Jeffrey Kam" },
  { id: 54, author: "Nicholas Swanson" },
  { id: 62, author: "Daniel Genser" },
  { id: 66, author: "Nicholas Swanson" },
  { id: 77, author: "May Pamintuan" },
  { id: 83, author: "Julie Geiger" },
  { id: 110, author: "Kenneth Thewissen" },
  { id: 116, author: "Anton Sulsky" },
  { id: 124, author: "Anton Sulsky" },
  { id: 128, author: "Matteo Minelli" },
  { id: 142, author: "Vadim Sherbakov" },
  { id: 162, author: "Dillon McIntosh" },
  { id: 164, author: "Linh Nguyen" },
  { id: 166, author: "Romain Briaux" },
  { id: 179, author: "Angelina Odemchuk" },
  { id: 182, author: "Andrea Boldizsar" },
  { id: 184, author: "Tim de Groot" },
  { id: 191, author: "Alex Talmon" },
  { id: 196, author: "Dyaa Eldin Moustafa" },
  { id: 202, author: "Glen Carrie" },
  { id: 204, author: "Tiago Gerken" },
  { id: 206, author: "Philipp Reiner" },
  { id: 217, author: "Tom Butler" },
  { id: 218, author: "Monika Majkowska" },
  { id: 231, author: "Aleksandra Boguslawska" },
  { id: 235, author: "Paul E. Harrer" },
  { id: 243, author: "Orlova Maria" },
  { id: 251, author: "Tiago Gerken" },
  { id: 255, author: "Jon Ottosson" },
  { id: 256, author: "Sylwia Bartyzel" },
  { id: 271, author: "Fré Sonneveld" },
  { id: 277, author: "Taylor Leopold" },
  { id: 287, author: "Aleksandra Boguslawska" },
  { id: 293, author: "Paul E. Harrer" },
  { id: 296, author: "Greg Shield" },
  { id: 313, author: "Sonja Langford" },
];

export type LockPhoto = { url: string; author: string | null };

/** A new photo every day, like Spark; "Next photo" in Settings moves along the list. */
export function lockPhoto(personal: Personal, now: number, size: "full" | "thumb" = "full"): LockPhoto | null {
  if (personal.background === "plain") return null;
  if (personal.background === "custom" && personal.custom) return { url: personal.custom, author: null };
  const day = Math.floor((now - new Date(now).getTimezoneOffset() * 60_000) / 86_400_000);
  const photo = PHOTOS[(((day + personal.shift) % PHOTOS.length) + PHOTOS.length) % PHOTOS.length];
  const [w, h] = size === "full" ? [2400, 1500] : [480, 300];
  return { url: `https://picsum.photos/id/${photo.id}/${w}/${h}.webp`, author: photo.author };
}

/** Scales a picked file down so it fits in the browser's storage (~5 MB per site). */
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.55]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length < 2_500_000) return url;
  }
  throw new Error("This photo is too large. Try a smaller one.");
}
