import { wakeSnoozes } from "../server/actions";
import { holdDb, persistDb } from "../server/snapshot";
import { accountIds, syncAccount } from "../server/sync";
import { reconcilePush } from "./push";

const INTERVAL_MS = 30_000;
// Serverless hosts cannot keep IMAP connections open between requests.
const PUSH = process.env.VERCEL !== "1" && process.env.CLARITY_PUSH !== "0";

async function tick() {
  if (PUSH) {
    try {
      await reconcilePush();
    } catch (err) {
      console.error("[push]", err instanceof Error ? err.message : err);
    }
  }
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

// A dropped connection is the mail server's problem, not a reason for the worker to exit.
const NETWORK_CODES = new Set([
  "ETIMEOUT",
  "ETIMEDOUT",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "NoConnection",
]);

function guardProcess() {
  process.on("unhandledRejection", (reason) => {
    console.error("[worker] unhandled rejection", reason instanceof Error ? reason.message : reason);
  });
  process.on("uncaughtException", (err) => {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    console.error("[worker] uncaught", code, err instanceof Error ? err.message : err);
    if (!NETWORK_CODES.has(code)) process.exit(1);
  });
}

const entry = process.argv[1] ?? "";
if (entry.includes("/worker/") || entry.includes("\\worker\\")) {
  guardProcess();
  startBackgroundSync();
}
