import { wakeSnoozes } from "../server/actions";
import { holdDb, persistDb } from "../server/snapshot";
import { accountIds, syncAccount } from "../server/sync";

const INTERVAL_MS = 30_000;

async function tick() {
  try {
    await holdDb(async () => {
      try {
        await wakeSnoozes();
      } catch (err) {
        console.error("[sync] snooze", err instanceof Error ? err.message : err);
      }
      for (const id of accountIds()) {
        try {
          await syncAccount(id);
        } catch (err) {
          console.error("[sync]", id, err instanceof Error ? err.message : err);
        }
      }
    });
  } catch (err) {
    console.error("[sync] store", err instanceof Error ? err.message : err);
    return;
  }
  try {
    await persistDb();
  } catch (err) {
    console.error("[sync] snapshot", err instanceof Error ? err.message : err);
  }
}

let started = false;

export function startBackgroundSync() {
  if (started) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  started = true;
  console.log("[sync] worker started");
  void tick();
  setInterval(() => void tick(), INTERVAL_MS);
}

const entry = process.argv[1] ?? "";
if (entry.includes("/worker/") || entry.includes("\\worker\\")) startBackgroundSync();
