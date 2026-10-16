import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  lstatSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { iconIcns } from "./icon.mjs";

const desktop = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(desktop);
const cache = path.join(desktop, "cache");
const staging = path.join(desktop, "staging");
const serverDir = path.join(staging, "server");
const NODE_VERSION = "22.23.3";
const ELECTRON_VERSION = "44.8.0";
const SQLITE_TOOLS = {
  arm64: "sqlite-tools-osx-arm64-3540000.zip",
  x64: "sqlite-tools-osx-x64-3540000.zip",
};
const RCODESIGN =
  "https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/0.29.0/apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz";

const ARCHES = [
  { arch: "arm64", folder: "Clarity-Mail-Apple-Silicon", chip: "Apple Silicon (M1, M2, M3, M4)" },
  { arch: "x64", folder: "Clarity-Mail-Intel", chip: "Intel" },
];

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...opts });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) return dest;
  mkdirSync(path.dirname(dest), { recursive: true });
  process.stdout.write(`download ${url}\n`);
  const bytes = await fetchBytes(url);
  writeFileSync(dest, bytes);
  return dest;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function secretValues() {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return [];
  const values = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/KEY|SECRET|TOKEN|PASSWORD/i.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length >= 20) values.push(value);
  }
  return values;
}

function walk(dir, visit) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) continue;
    if (info.isDirectory()) walk(full, visit);
    else visit(full, info);
  }
}

function assertNoSecrets(dir) {
  const values = secretValues();
  if (values.length === 0) return;
  walk(dir, (file, info) => {
    if (info.size > 20_000_000) return;
    if (!/\.(js|mjs|cjs|json|env|txt|html)$/i.test(file)) return;
    const text = readFileSync(file);
    for (const value of values) {
      if (text.includes(value)) {
        throw new Error(`Refusing to package ${path.relative(root, file)}: it contains a secret from .env`);
      }
    }
  });
}

function stripEnvFiles(dir) {
  walk(dir, (file) => {
    const base = path.basename(file);
    if (base === ".env" || base.startsWith(".env.")) rmSync(file);
  });
}

async function writeIcon() {
  const dir = path.join(desktop, "build");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "icon.icns"), iconIcns());
}

async function buildNext() {
  await run("npm", ["run", "build"], {
    cwd: root,
    env: { ...process.env, NEXT_DESKTOP_BUILD: "1" },
  });
}

function stageServer() {
  const standalone = path.join(root, ".next-desktop", "standalone");
  const serverJs = path.join(standalone, "server.js");
  if (!existsSync(serverJs)) throw new Error(`Missing ${serverJs}`);
  rmSync(serverDir, { recursive: true, force: true });
  mkdirSync(serverDir, { recursive: true });
  cpSync(standalone, serverDir, { recursive: true, dereference: true });
  const staticSrc = path.join(root, ".next-desktop", "static");
  if (!existsSync(staticSrc)) throw new Error("The desktop build did not emit static files");
  cpSync(staticSrc, path.join(serverDir, ".next-desktop", "static"), { recursive: true, dereference: true });
  const prebuilds = path.join(root, "node_modules", "better-sqlite3", "prebuilds");
  const dest = path.join(serverDir, "node_modules", "better-sqlite3", "prebuilds");
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(prebuilds)) {
    if (name.endsWith(".node")) copyFileSync(path.join(prebuilds, name), path.join(dest, name));
  }
  const keep = new Set(["server.js", "package.json", "node_modules", ".next-desktop", "public"]);
  for (const name of readdirSync(serverDir)) {
    if (!keep.has(name)) rmSync(path.join(serverDir, name), { recursive: true, force: true });
  }
  stripEnvFiles(serverDir);
  assertNoSecrets(serverDir);
  if (!existsSync(path.join(serverDir, "node_modules", "better-sqlite3", "prebuilds", "darwin-arm64.node"))) {
    throw new Error("darwin sqlite prebuild missing from the staged server");
  }
}

async function smokeServer() {
  const dataDir = path.join(cache, "smoke-data");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const port = 47318;
  const env = { ...process.env };
  for (const key of [
    "BLOB_READ_WRITE_TOKEN",
    "SORTED_SECRET",
    "DEEPSEEK_API_KEY",
    "MISTRAL_API_KEY",
    "SORTED_SECURE_COOKIE",
    "SORTED_DEV_LOGIN_HINT",
  ]) {
    delete env[key];
  }
  env.NODE_ENV = "production";
  env.PORT = String(port);
  env.HOSTNAME = "127.0.0.1";
  env.SORTED_DATA_DIR = dataDir;
  const child = spawn(process.execPath, ["server.js"], { cwd: serverDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  const deadline = Date.now() + 60000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/login`);
        if (response.status === 200) {
          const html = await response.text();
          if (!html.includes("Clarity Mail")) throw new Error("Login page did not include Clarity Mail");
          if (!log.includes("[sync] worker started")) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          if (!log.includes("[sync] worker started")) {
            throw new Error(`Worker did not start.\n${log.slice(-2000)}`);
          }
          if (!existsSync(path.join(dataDir, "sorted.db"))) {
            throw new Error("The server did not store the mailbox in SORTED_DATA_DIR");
          }
          if (existsSync(path.join(serverDir, "data"))) {
            throw new Error("The server wrote the mailbox inside the app bundle");
          }
          return;
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("Login")) throw err;
        if (err instanceof Error && err.message.startsWith("Worker")) throw err;
        if (err instanceof Error && err.message.startsWith("The server")) throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Standalone server did not serve /login.\n${log.slice(-2000)}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function installBuilder() {
  if (existsSync(path.join(desktop, "node_modules", "electron-builder", "package.json"))) return;
  await run("npm", ["install", "--no-fund", "--no-audit"], { cwd: desktop });
}

async function nodeBinary(arch) {
  const sums = await fetchBytes(`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`);
  const name = `node-v${NODE_VERSION}-darwin-${arch}.tar.gz`;
  const expected = sums
    .toString("utf8")
    .split("\n")
    .find((line) => line.endsWith(name))
    ?.split(/\s+/)[0];
  if (!expected) throw new Error(`No checksum for ${name}`);
  const archive = await download(`https://nodejs.org/dist/v${NODE_VERSION}/${name}`, path.join(cache, name));
  const actual = sha256(archive);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${name}`);
  const destDir = path.join(staging, "bin", arch);
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "node");
  await new Promise((resolve, reject) => {
    const out = spawn("tar", ["-xOf", archive, `node-v${NODE_VERSION}-darwin-${arch}/bin/node`], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const chunks = [];
    out.stdout.on("data", (chunk) => chunks.push(chunk));
    out.on("error", reject);
    out.on("close", (code) => {
      if (code !== 0) reject(new Error(`tar exited ${code}`));
      else {
        writeFileSync(dest, Buffer.concat(chunks));
        chmodSync(dest, 0o755);
        resolve();
      }
    });
  });
  await expectMachO(dest, arch);
}

async function sqliteBinary(arch) {
  const page = (await fetchBytes("https://www.sqlite.org/download.html")).toString("utf8");
  const file = SQLITE_TOOLS[arch];
  const href = page.match(new RegExp(`(?:https?:)?//[^"'\\s]*${file}|/?\\d{4}/${file}`))?.[0];
  if (!href) throw new Error(`sqlite.org has no ${file}`);
  const url = href.startsWith("http") ? href : `https://sqlite.org/${href.replace(/^\/+/, "")}`;
  const archive = await download(url, path.join(cache, file));
  const unpack = path.join(cache, `sqlite-${arch}`);
  rmSync(unpack, { recursive: true, force: true });
  mkdirSync(unpack, { recursive: true });
  await run("unzip", ["-q", archive, "-d", unpack]);
  let found = "";
  walk(unpack, (candidate) => {
    if (path.basename(candidate) === "sqlite3") found = candidate;
  });
  if (!found) throw new Error(`sqlite3 binary missing from ${file}`);
  const destDir = path.join(staging, "bin", arch);
  mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "sqlite3");
  copyFileSync(found, dest);
  chmodSync(dest, 0o755);
  await expectMachO(dest, arch);
}

function expectMachO(file, arch) {
  return new Promise((resolve, reject) => {
    const child = spawn("file", ["-b", file], { stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("exit", (code) => {
      const needle = arch === "arm64" ? "arm64" : "x86_64";
      if (code === 0 && text.includes("Mach-O") && text.includes(needle)) resolve(text.trim());
      else reject(new Error(`${file} is not a ${needle} Mach-O (${text.trim()})`));
    });
  });
}

async function signer() {
  const archive = await download(RCODESIGN, path.join(cache, "apple-codesign.tar.gz"));
  const bin = path.join(cache, "rcodesign");
  if (!existsSync(bin)) {
    await new Promise((resolve, reject) => {
      const out = spawn("tar", ["-xOf", archive, "--wildcards", "*/rcodesign"], {
        stdio: ["ignore", "pipe", "inherit"],
      });
      const chunks = [];
      out.stdout.on("data", (chunk) => chunks.push(chunk));
      out.on("error", reject);
      out.on("close", (code) => {
        if (code !== 0) reject(new Error(`rcodesign extract exited ${code}`));
        else {
          writeFileSync(bin, Buffer.concat(chunks));
          chmodSync(bin, 0o755);
          resolve();
        }
      });
    });
  }
  return bin;
}

function readme(chip) {
  return `Clarity Mail pour Mac — ${chip}

1. Glissez « Clarity Mail.app » dans le dossier Applications, ou laissez-la ici.
2. Premier lancement : clic droit sur l'app, puis Ouvrir, puis Ouvrir.
   L'app n'est pas notarisée par Apple. C'est normal pour cette copie de test.
3. Si macOS dit que l'app est endommagée, ouvrez Terminal et lancez :
   xattr -dr com.apple.quarantine "/chemin/vers/Clarity Mail.app"
4. Au premier écran, choisissez un mot de passe pour Clarity Mail.
   Ensuite, dans Settings, ajoutez iCloud et OVH.
5. Les mails de cette app restent sur ce Mac :
   ~/Library/Application Support/Clarity Mail
   Pour le résumé IA, créez le fichier clarity.env dans ce dossier :

   DEEPSEEK_API_KEY=votre-cle

   Rouvrez l'app ensuite. Sans clé, le tri reste sur les règles du texte.
6. Fermer la fenêtre laisse la synchro en marche. Pour quitter :
   menu Clarity Mail, puis Quitter.

Cette copie est indépendante du site clarity-mail.vercel.app.
Le mot de passe et les comptes se règlent à nouveau ici.

Pour savoir quelle archive choisir : menu Pomme, À propos de ce Mac.
Une puce Apple (M1, M2, M3, M4) utilise l'archive Apple Silicon.
Un processeur Intel utilise l'archive Intel.
`;
}

async function pack(arch, rcodesign) {
  const config = {
    appId: "mail.clarity.app",
    productName: "Clarity Mail",
    electronVersion: ELECTRON_VERSION,
    npmRebuild: false,
    buildDependenciesFromSource: false,
    asar: true,
    directories: { output: "dist" },
    files: ["main.js", "package.json"],
    extraResources: [
      { from: "staging/payload", to: "server" },
      { from: `staging/bin/${arch}`, to: "bin" },
    ],
    mac: {
      category: "public.app-category.productivity",
      icon: "build/icon.icns",
      identity: null,
      gatekeeperAssess: false,
      hardenedRuntime: false,
      target: [{ target: "dir", arch: [arch] }],
    },
  };
  const configPath = path.join(cache, `builder-${arch}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  await run(path.join(desktop, "node_modules", ".bin", "electron-builder"), ["--mac", `--${arch}`, "--dir", "--config", configPath], {
    cwd: desktop,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      ELECTRON_CACHE: path.join(cache, "electron"),
      ELECTRON_BUILDER_CACHE: path.join(cache, "builder"),
    },
  });
  const candidates = [
    path.join(desktop, "dist", `mac-${arch}`, "Clarity Mail.app"),
    path.join(desktop, "dist", "mac", "Clarity Mail.app"),
  ];
  const built = candidates.find((candidate) => existsSync(candidate));
  if (!built) throw new Error(`electron-builder did not produce a ${arch} app`);
  const hold = path.join(desktop, "dist", `app-${arch}`);
  rmSync(hold, { recursive: true, force: true });
  mkdirSync(hold, { recursive: true });
  await run("cp", ["-a", built, path.join(hold, "Clarity Mail.app")]);
  const app = path.join(hold, "Clarity Mail.app");
  await run(rcodesign, ["sign", app]);
  return app;
}

function zipSymlinkCount(zip) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        "-c",
        "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(sum(1 for i in z.infolist() if ((i.external_attr>>16)&0o170000)==0o120000))",
        zip,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk.toString();
    });
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error("Could not inspect the zip"));
      else resolve(Number(text.trim()));
    });
  });
}

async function bundle(archInfo, app) {
  const { folder, chip } = archInfo;
  const dir = path.join(desktop, "dist", folder);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  await run("cp", ["-a", app, path.join(dir, "Clarity Mail.app")]);
  writeFileSync(path.join(dir, "Lisez-moi.txt"), readme(chip));
  const zip = path.join(desktop, "dist", `${folder}.zip`);
  rmSync(zip, { force: true });
  await run("zip", ["-r", "-y", "-q", zip, folder], { cwd: path.join(desktop, "dist") });
  const links = await zipSymlinkCount(zip);
  if (links < 1) throw new Error(`${zip} lost the app's internal symlinks`);
  return zip;
}

function assertNoMailbox(dir) {
  walk(dir, (file) => {
    const base = path.basename(file);
    if (base === "secret" || base === "sorted.db" || base === ".env" || base.startsWith(".env.")) {
      throw new Error(`Refusing to package ${path.relative(root, file)}`);
    }
  });
}

function nestServer() {
  const payload = path.join(staging, "payload");
  rmSync(payload, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });
  renameSync(serverDir, path.join(payload, "app"));
}

async function main() {
  mkdirSync(cache, { recursive: true });
  await writeIcon();
  const rcodesignPromise = signer();
  const runtimePromise = Promise.all(ARCHES.map(({ arch }) => Promise.all([nodeBinary(arch), sqliteBinary(arch)])));
  await Promise.all([buildNext(), installBuilder(), runtimePromise, rcodesignPromise]);
  stageServer();
  await smokeServer();
  nestServer();
  const rcodesign = await rcodesignPromise;
  const zips = [];
  for (const archInfo of ARCHES) {
    const app = await pack(archInfo.arch, rcodesign);
    const executable = path.join(app, "Contents", "MacOS", "Clarity Mail");
    await expectMachO(executable, archInfo.arch);
    await expectMachO(path.join(app, "Contents", "Resources", "bin", "node"), archInfo.arch);
    await expectMachO(path.join(app, "Contents", "Resources", "bin", "sqlite3"), archInfo.arch);
    await expectMachO(
      path.join(app, "Contents", "Resources", "server", "app", "node_modules", "better-sqlite3", "prebuilds", `darwin-${archInfo.arch}.node`),
      archInfo.arch,
    );
    assertNoMailbox(app);
    zips.push(await bundle(archInfo, app));
  }
  mkdirSync("/opt/cursor/artifacts", { recursive: true });
  const sums = [];
  for (const zip of zips) {
    const base = path.basename(zip);
    sums.push(`${sha256(zip)}  ${base}`);
    const parts = await splitZip(zip);
    for (const part of parts) {
      const dest = path.join("/opt/cursor/artifacts", path.basename(part));
      await streamCopy(part, dest);
      if (statSync(dest).size !== statSync(part).size) {
        throw new Error(`Artifact copy truncated: ${dest}`);
      }
      sums.push(`${sha256(dest)}  ${path.basename(dest)}`);
      process.stdout.write(`${path.basename(dest)} ${statSync(dest).size}\n`);
    }
  }
  const note = `${sums.join("\n")}\n`;
  writeFileSync("/opt/cursor/artifacts/Clarity-Mail-SHA256.txt", note);
  writeFileSync(path.join(desktop, "dist", "SHA256.txt"), note);
}

function splitZip(zip) {
  const dir = path.join(desktop, "dist", "parts");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const prefix = path.join(dir, `${path.basename(zip, ".zip")}.part`);
  return new Promise((resolve, reject) => {
    const child = spawn("split", ["-b", "80m", "-d", "-a", "2", zip, prefix], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`split exited ${code}`));
      else resolve(readdirSync(dir).sort().map((name) => path.join(dir, name)));
    });
  });
}

function streamCopy(from, to) {
  return pipeline(createReadStream(from), createWriteStream(to));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
