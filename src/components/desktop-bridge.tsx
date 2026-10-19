"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isLowValue } from "@/lib/priority";
import { useStore } from "@/lib/store";

export type LockPrefs = { lockAfterMinutes: number; lockOnSleep: boolean };

type DesktopApi = {
  setBadge: (count: number) => void;
  focus: () => void;
  lock: () => void;
  getPrefs: () => Promise<(LockPrefs & { touchId: boolean }) | null>;
  setPrefs: (next: LockPrefs) => Promise<LockPrefs | null>;
  unlockWithTouchId: () => Promise<{ ok: boolean; error?: string }>;
};

declare global {
  interface Window {
    /** Set by the Mac app's preload script; absent in a browser. */
    clarityDesktop?: DesktopApi;
  }
}

/**
 * Mac app extras: the unread count on the Dock icon, and a notification for
 * new mail that matters while the window is in the background.
 */
export function DesktopBridge() {
  const { ready, scored, select } = useStore();
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  const unread = scored.filter((t) => t.status === "inbox" && t.unread).length;
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    window.clarityDesktop?.setBadge(unread);
    document.title = unread > 0 ? `(${unread}) Clarity Mail` : "Clarity Mail";
  }, [ready, unread, pathname]);

  useEffect(() => {
    if (!ready) return;
    const worth = scored.filter((t) => {
      if (t.status !== "inbox" || !t.unread || isLowValue(t)) return false;
      const last = t.messages[t.messages.length - 1];
      const mine = [t.account.email, ...t.account.aliases].map((a) => a.toLowerCase());
      return !mine.includes(last.from.email.toLowerCase());
    });
    const key = (t: (typeof worth)[number]) => `${t.id}:${t.messages.length}`;
    if (seen.current === null) {
      seen.current = new Set(worth.map(key));
      return;
    }
    const known = seen.current;
    const fresh = worth.filter((t) => !known.has(key(t)));
    for (const t of fresh) known.add(key(t));

    const desktop = window.clarityDesktop;
    if (fresh.length === 0 || !desktop || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted" || document.hasFocus()) return;

    const open = (id?: string) => {
      desktop.focus();
      router.push("/inbox/all");
      if (id) select(id);
    };
    if (fresh.length > 3) {
      const note = new Notification(`${fresh.length} new conversations`, {
        body: fresh
          .slice(0, 3)
          .map((t) => t.messages[t.messages.length - 1].from.name)
          .join(", "),
        silent: false,
      });
      note.onclick = () => open();
      return;
    }
    for (const t of fresh) {
      const last = t.messages[t.messages.length - 1];
      const note = new Notification(last.from.name, { body: t.subject || "(no subject)", tag: t.id });
      note.onclick = () => open(t.id);
    }
  }, [ready, scored, router, select]);

  return null;
}
