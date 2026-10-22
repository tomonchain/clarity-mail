"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { scoreAll } from "./priority";
import type { Account, Provider, RoutingRule, ScoredThread, Space, SpaceId, Thread, ThreadStatus } from "./types";

type Data = {
  spaces: Space[];
  accounts: Account[];
  rules: RoutingRule[];
  threads: Thread[];
  revision: number;
  notice: string | null;
};

/** One change applied to many threads at once (multi-select). */
export type BulkAction =
  | { kind: "status"; status: ThreadStatus; snoozedUntil?: number }
  | { kind: "read"; unread: boolean }
  | { kind: "star"; starred: boolean }
  | { kind: "move"; space: SpaceId };

function applyBulk(thread: Thread, action: BulkAction): Thread {
  switch (action.kind) {
    case "status":
      return {
        ...thread,
        status: action.status,
        snoozedUntil: action.snoozedUntil,
        unread: action.status === "inbox" ? thread.unread : false,
      };
    case "read":
      return { ...thread, unread: action.unread };
    case "star":
      return { ...thread, starred: action.starred };
    case "move":
      return { ...thread, spaceOverride: action.space };
  }
}

type Store = Data & {
  ready: boolean;
  error: string | null;
  now: number;
  scored: ScoredThread[];
  selectedId: string | null;
  select: (id: string | null) => void;
  setStatus: (id: string, status: ThreadStatus, snoozedUntil?: number) => void;
  toggleStar: (id: string) => void;
  setUnread: (id: string, unread: boolean) => void;
  moveToSpace: (id: string, space: SpaceId) => void;
  bulk: (ids: string[], action: BulkAction) => void;
  reply: (id: string, from: string, body: string) => Promise<void>;
  clearThreads: (ids: string[]) => void;
  purgeThreads: (ids: string[]) => void;
  restoreThreads: (snapshot: Thread[]) => void;
  addRule: (rule: Omit<RoutingRule, "id">) => void;
  removeRule: (id: string) => void;
  updateAccount: (id: string, patch: Partial<Account>) => void;
  updateAccountPassword: (id: string, password: string) => Promise<void>;
  updateSpace: (id: SpaceId, patch: Partial<Space>) => void;
  addSpace: (name: string) => void;
  removeSpace: (id: SpaceId) => void;
  addAccount: (input: Record<string, unknown>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  syncAccount: (id: string) => Promise<void>;
  testAccount: (input: Record<string, unknown>) => Promise<void>;
  detectAccount: (email: string) => Promise<DetectedSettings>;
  sendMail: (input: { from: string; to: string; cc?: string; subject: string; body: string }) => Promise<void>;
  refresh: () => Promise<void>;
};

export type DetectedSettings = {
  provider: Provider;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  source: "domain" | "mx" | "autoconfig" | "guess";
  help?: string;
};

type AccountStatus = Pick<Account, "id" | "lastSyncAt" | "syncError" | "syncing">;

/** Lay fresh sync status over the accounts. Unchanged status keeps the same object (no re-render). */
function withStatus(current: Data, status: AccountStatus[]): Data {
  let changed = false;
  const accounts = current.accounts.map((account) => {
    const s = status.find((x) => x.id === account.id);
    if (
      !s ||
      (s.lastSyncAt === account.lastSyncAt && s.syncError === account.syncError && s.syncing === account.syncing)
    ) {
      return account;
    }
    changed = true;
    return { ...account, lastSyncAt: s.lastSyncAt, syncError: s.syncError, syncing: s.syncing };
  });
  return changed ? { ...current, accounts } : current;
}

const StoreContext = createContext<Store | null>(null);

function signInAgain() {
  window.location.replace(`${window.location.origin}/login`);
}

async function post(op: string, payload: Record<string, unknown> = {}) {
  const res = await fetch("/api/mutate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, ...payload }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401) {
    signInAgain();
    throw new Error("Sign in first.");
  }
  if (!res.ok) throw new Error(body.error || "Request failed.");
  return body;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Optimistic changes still on their way to the mail server. A mailbox loaded meanwhile
  // (a push, a poll) predates them: they are laid over it, so a deleted mail never comes back.
  const pending = useRef(new Map<number, { patch: (current: Data) => Data; settledAt: number | null }>());
  const opCount = useRef(0);
  const loadsStarted = useRef(0);
  const loadShown = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++loadsStarted.current;
    const res = await fetch("/api/state", { cache: "no-store" });
    if (res.status === 401) {
      signInAgain();
      return;
    }
    if (!res.ok) throw new Error("Could not load your mail.");
    const fresh = (await res.json()) as Data;
    // Answers can arrive out of order: never replace a newer mailbox with an older one.
    if (seq < loadShown.current) return;
    loadShown.current = seq;
    let next = fresh;
    for (const [id, change] of pending.current) {
      // Loaded after the server applied the change: it is in the data already.
      if (change.settledAt !== null && seq > change.settledAt) {
        pending.current.delete(id);
        continue;
      }
      next = change.patch(next);
    }
    setData(next);
    setError(null);
  }, []);

  useEffect(() => {
    let cancel = false;
    let known: number | null = null;
    let checking = false;
    const load = () => {
      refresh().catch((err: unknown) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load your mail.");
      });
    };
    // Poll the tiny revision number; fetch the whole mailbox only when it moved.
    const check = async () => {
      if (checking || cancel) return;
      // A hidden tab or a phone in the pocket does not poll; it catches up when shown.
      // The Mac app keeps checking so it can notify about new mail.
      if (document.visibilityState === "hidden" && !window.clarityDesktop) return;
      checking = true;
      try {
        const res = await fetch("/api/revision", { cache: "no-store" });
        if (res.status === 401) {
          signInAgain();
          return;
        }
        if (!res.ok) return;
        const { revision, accounts } = (await res.json()) as { revision: number; accounts?: AccountStatus[] };
        if (known !== null && revision !== known) load();
        else if (accounts) setData((current) => (current ? withStatus(current, accounts) : current));
        known = revision;
      } catch {
        // Offline for a moment: the next check catches up.
      } finally {
        checking = false;
      }
    };
    load();
    void check();
    const fast = window.clarityDesktop ? 3_000 : 10_000;
    const quick = setInterval(() => void check(), fast);
    // Sync status comes with each check; a full reload now and then is only the safety net.
    const poll = setInterval(() => {
      if (document.visibilityState !== "hidden" || window.clarityDesktop) load();
    }, 5 * 60_000);
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    // Back on the app: the revision check reloads the mailbox only if something changed.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancel = true;
      clearInterval(quick);
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const run = useCallback(
    (
      op: string,
      payload: Record<string, unknown>,
      optimistic?: (current: Data) => Data,
      onDone?: (result: Record<string, unknown>) => void,
    ) => {
      const id = ++opCount.current;
      if (optimistic) {
        pending.current.set(id, { patch: optimistic, settledAt: null });
        setData((current) => (current ? optimistic(current) : current));
      }
      void post(op, payload)
        .then((result) => {
          onDone?.(result);
          const change = pending.current.get(id);
          // Loads started from now on see the change; earlier ones still need the overlay.
          if (change) change.settledAt = loadsStarted.current;
          return refresh();
        })
        .catch((err: unknown) => {
          pending.current.delete(id);
          toast.error(err instanceof Error ? err.message : "Request failed.");
          void refresh().catch(() => undefined);
        });
    },
    [refresh],
  );

  const scored = useMemo(
    () => (data ? scoreAll(data.threads, data.accounts, data.spaces, data.rules, now) : []),
    [data, now],
  );

  const value = useMemo<Store>(() => {
    const current = data ?? { spaces: [], accounts: [], rules: [], threads: [], revision: 0, notice: null };
    return {
      ...current,
      ready: data !== null,
      error,
      now,
      scored,
      selectedId,
      select: setSelectedId,
      setStatus: (id, status, snoozedUntil) =>
        run("thread.status", { id, status, snoozedUntil }, (d) => ({
          ...d,
          threads: d.threads.map((t) =>
            t.id === id ? { ...t, status, snoozedUntil, unread: status === "inbox" ? t.unread : false } : t,
          ),
        })),
      toggleStar: (id) => {
        const starred = !current.threads.find((t) => t.id === id)?.starred;
        run("thread.star", { id, starred }, (d) => ({
          ...d,
          threads: d.threads.map((t) => (t.id === id ? { ...t, starred } : t)),
        }));
      },
      setUnread: (id, unread) =>
        run("thread.read", { id, unread }, (d) => ({
          ...d,
          threads: d.threads.map((t) => (t.id === id ? { ...t, unread } : t)),
        })),
      moveToSpace: (id, space) =>
        run("thread.move", { id, space }, (d) => ({
          ...d,
          threads: d.threads.map((t) => (t.id === id ? { ...t, spaceOverride: space } : t)),
        })),
      bulk: (ids, action) => {
        if (ids.length === 0) return;
        const set = new Set(ids);
        run(
          "thread.bulk",
          { ids, action },
          (d) => ({ ...d, threads: d.threads.map((t) => (set.has(t.id) ? applyBulk(t, action) : t)) }),
          (result) => {
            const failed = Number(result.failed) || 0;
            if (failed > 0) {
              toast.error(`${failed === 1 ? "1 conversation" : `${failed} conversations`} could not be updated.`);
            }
          },
        );
      },
      reply: async (id, from, body) => {
        await post("thread.reply", { id, from, body });
        await refresh();
      },
      clearThreads: (ids) =>
        run("thread.clear", { ids }, (d) => ({
          ...d,
          threads: d.threads.map((t) => (ids.includes(t.id) ? { ...t, status: "done", unread: false } : t)),
        })),
      purgeThreads: (ids) =>
        run("thread.purge", { ids }, (d) => ({ ...d, threads: d.threads.filter((t) => !ids.includes(t.id)) })),
      restoreThreads: (snapshot) =>
        run(
          "thread.restore",
          {
            threads: snapshot.map((t) => ({
              id: t.id,
              status: t.status,
              unread: t.unread,
              starred: t.starred,
              snoozedUntil: t.snoozedUntil,
            })),
          },
          (d) => ({
            ...d,
            threads: d.threads.map((t) => snapshot.find((s) => s.id === t.id) ?? t),
          }),
        ),
      addRule: (rule) => run("rule.add", rule),
      removeRule: (id) =>
        run("rule.remove", { id }, (d) => ({ ...d, rules: d.rules.filter((r) => r.id !== id) })),
      updateAccount: (id, patch) => {
        const payload: Record<string, unknown> = { id };
        if (patch.label !== undefined) payload.label = patch.label;
        if (patch.defaultSpace) payload.defaultSpace = patch.defaultSpace;
        if (patch.aliases) payload.aliases = patch.aliases;
        if (Object.keys(payload).length === 1) return;
        run("account.update", payload, (d) => ({
          ...d,
          accounts: d.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
      },
      updateAccountPassword: async (id, password) => {
        await post("account.update", { id, password });
        await refresh();
      },
      updateSpace: (id, patch) => {
        const payload: Record<string, unknown> = { id, ...patch };
        if ("focusHours" in patch && patch.focusHours == null) payload.focusHours = null;
        if ("slaHours" in patch && patch.slaHours == null) payload.slaHours = null;
        run("space.update", payload, (d) => ({
          ...d,
          spaces: d.spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }));
      },
      addSpace: (name) => run("space.add", { name }),
      removeSpace: (id) => run("space.remove", { id }),
      addAccount: async (input) => {
        await post("account.create", input);
        await refresh();
      },
      removeAccount: async (id) => {
        await post("account.delete", { id });
        await refresh();
      },
      syncAccount: async (id) => {
        await post("account.sync", { id });
        await refresh();
      },
      testAccount: async (input) => {
        await post("account.test", input);
      },
      detectAccount: async (email) => (await post("account.detect", { email })) as unknown as DetectedSettings,
      sendMail: async (input) => {
        await post("mail.send", input);
        await refresh();
      },
      refresh,
    };
  }, [data, error, now, scored, selectedId, run, refresh]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
