import { createHash } from "node:crypto";
import type { ImapFlow } from "imapflow";
import { loadAccount, openImap, type MailAccount } from "../server/connection";
import { holdDb } from "../server/snapshot";
import { accountIds, folderPath, syncAccount } from "../server/sync";

/**
 * Push: one IMAP connection per mailbox waits on the inbox with IDLE, so the
 * server tells Clarity about new mail as it lands. Each signal syncs just the
 * inbox. The periodic full sync stays as the safety net.
 */

const DEBOUNCE_MS = 800;
const FIRST_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
// Restart IDLE now and then: some servers and routers drop connections that stay silent.
const IDLE_RESTART_MS = 4 * 60_000;

type Watcher = {
  id: string;
  key: string;
  stopped: boolean;
  client: ImapFlow | null;
  debounce: ReturnType<typeof setTimeout> | null;
  wake: (() => void) | null;
};

const watchers = new Map<string, Watcher>();

function fingerprint(account: MailAccount) {
  return createHash("sha256")
    .update(JSON.stringify([account.imapHost, account.imapPort, account.imapSecure, account.username, account.password]))
    .digest("hex");
}

function message(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function scheduleSync(watcher: Watcher) {
  if (watcher.debounce) clearTimeout(watcher.debounce);
  watcher.debounce = setTimeout(() => {
    watcher.debounce = null;
    if (watcher.stopped) return;
    syncAccount(watcher.id, { inboxOnly: true }).catch((err) =>
      console.error("[push]", watcher.id, "sync:", message(err)),
    );
  }, DEBOUNCE_MS);
}

function pause(watcher: Watcher, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      watcher.wake = null;
      resolve();
    }
    watcher.wake = done;
  });
}

async function watch(watcher: Watcher) {
  let failures = 0;
  while (!watcher.stopped) {
    let account: MailAccount;
    let inbox: string;
    try {
      ({ account, inbox } = await holdDb(async () => ({
        account: loadAccount(watcher.id),
        inbox: folderPath(watcher.id, "inbox") ?? "INBOX",
      })));
    } catch {
      // The account is gone; the next reconcile drops this watcher.
      return;
    }
    // Enter IDLE right after opening (the library default waits 15 s, a blind spot for new mail).
    const client = openImap(account, { maxIdleTime: IDLE_RESTART_MS, autoIdleDelay: 1000 });
    watcher.client = client;
    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    client.on("error", (err: unknown) => {
      if (!watcher.stopped) console.error("[push]", account.email, message(err));
    });
    // New mail, mail removed elsewhere, read on another device: sync the inbox.
    client.on("exists", () => scheduleSync(watcher));
    client.on("expunge", () => scheduleSync(watcher));
    client.on("flags", () => scheduleSync(watcher));
    try {
      await client.connect();
      await client.mailboxOpen(inbox, { readOnly: true });
      if (failures > 0) console.log("[push]", account.email, "reconnected");
      failures = 0;
      // Catch anything that arrived while the connection was down.
      scheduleSync(watcher);
      await closed;
    } catch (err) {
      if (!watcher.stopped && failures === 0) console.error("[push]", account.email, message(err));
    } finally {
      watcher.client = null;
      client.removeAllListeners();
      client.on("error", () => undefined);
      try {
        client.close();
      } catch {
        // Already closed.
      }
    }
    if (watcher.stopped) return;
    failures += 1;
    await pause(watcher, Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** (failures - 1)));
  }
}

function stop(watcher: Watcher) {
  watcher.stopped = true;
  watchers.delete(watcher.id);
  if (watcher.debounce) clearTimeout(watcher.debounce);
  watcher.wake?.();
  const client = watcher.client;
  if (client) {
    void client.logout().catch(() => {
      try {
        client.close();
      } catch {
        // Already closed.
      }
    });
  }
}

/** Watch every mailbox; restart a watcher when its server or password changes. */
export async function reconcilePush() {
  const accounts = await holdDb(async () =>
    accountIds().flatMap((id) => {
      try {
        return [{ id, key: fingerprint(loadAccount(id)) }];
      } catch {
        return [];
      }
    }),
  );
  const wanted = new Map(accounts.map((a) => [a.id, a.key]));
  for (const watcher of [...watchers.values()]) {
    if (wanted.get(watcher.id) !== watcher.key) stop(watcher);
  }
  for (const [id, key] of wanted) {
    if (watchers.has(id)) continue;
    const watcher: Watcher = { id, key, stopped: false, client: null, debounce: null, wake: null };
    watchers.set(id, watcher);
    void watch(watcher).finally(() => {
      if (watchers.get(id) === watcher) watchers.delete(id);
    });
  }
}

export function stopPush() {
  for (const watcher of [...watchers.values()]) stop(watcher);
}

export function pushWatcherCount() {
  return watchers.size;
}
