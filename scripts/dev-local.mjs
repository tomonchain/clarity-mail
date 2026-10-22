import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

// One command for local testing: the test mail server, a seeded mailbox, the website and the sync.
// Everything Clarity stores stays in ./data between runs, so the login and your accounts are kept.
const DEV = path.join(process.cwd(), ".dev");
const env = { ...process.env, SORTED_DEV_LOGIN_HINT: "1" };
const children = [];
let stopping = false;

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function findJava() {
  for (const candidate of [
    path.join(DEV, "jre", "Contents", "Home", "bin", "java"),
    path.join(DEV, "jre", "bin", "java"),
    process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, "bin", "java"),
    "/opt/homebrew/opt/openjdk/bin/java",
  ]) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return "java";
  } catch {
    return null;
  }
}

async function startMailServer() {
  if (await portOpen(3143)) {
    console.log("[dev] a test mail server is already running on 3143");
    return true;
  }
  const jar = path.join(DEV, "greenmail.jar");
  const java = findJava();
  if (!existsSync(jar) || !java) {
    console.log("[dev] no test mail server (run `npm run dev:setup` once). Starting without the sample mailbox.");
    return false;
  }
  const server = spawn(
    java,
    [
      "-Dgreenmail.setup.test.smtp",
      "-Dgreenmail.setup.test.imap",
      "-Dgreenmail.hostname=127.0.0.1",
      "-Dgreenmail.auth.disabled",
      "-jar",
      jar,
    ],
    { stdio: "ignore" },
  );
  children.push(server);
  for (let i = 0; i < 60; i += 1) {
    if (await portOpen(3143)) {
      console.log("[dev] test mail server on IMAP 3143 / SMTP 3025");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The test mail server did not start.");
}

function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit", env });
  children.push(child);
  return child;
}

function stop() {
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

async function main() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
  }

  if (await startMailServer()) {
    const code = await new Promise((resolve) => run("npx", ["tsx", "scripts/dev-bootstrap.ts"]).on("exit", resolve));
    if (code !== 0) throw new Error("Setting up the sample mailbox failed.");
  }

  const app = run("npx", [
    "concurrently",
    "-k",
    "-n",
    "web,sync",
    "next dev -p 4317",
    "tsx src/worker/index.ts",
  ]);
  console.log("[dev] open http://localhost:4317 (the password is shown on the sign-in page)");
  // Ctrl+C or a terminal closing ends the children with a signal: that is a normal stop.
  app.on("exit", (code, signal) => {
    const clean = stopping || signal !== null || code === 0 || code === 130 || code === 143;
    stop();
    process.exit(clean ? 0 : (code ?? 1));
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stop();
  process.exit(1);
});
