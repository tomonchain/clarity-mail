import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Downloads the local test mail server (GreenMail) and a Java runtime for it into .dev/.
// Run once; `npm run dev:local` then finds them there.
const DEV = path.join(process.cwd(), ".dev");
const GREENMAIL_URL = "https://repo1.maven.org/maven2/com/icegreen/greenmail-standalone/2.1.3/greenmail-standalone-2.1.3.jar";

async function download(url, file) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
}

function hasJava() {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(DEV, { recursive: true });
  const jar = path.join(DEV, "greenmail.jar");
  if (existsSync(jar)) console.log("GreenMail already in .dev/");
  else {
    console.log("downloading GreenMail…");
    await download(GREENMAIL_URL, jar);
  }

  const jre = path.join(DEV, "jre");
  if (existsSync(jre)) console.log("Java runtime already in .dev/");
  else if (hasJava()) console.log("using the Java already installed");
  else {
    const os = { darwin: "mac", linux: "linux" }[process.platform];
    const arch = { arm64: "aarch64", x64: "x64" }[process.arch];
    if (!os || !arch) throw new Error(`No Java download for ${process.platform}/${process.arch}. Install Java 11+ yourself.`);
    console.log("downloading a Java runtime (about 50 MB)…");
    const archive = path.join(DEV, "jre.tar.gz");
    await download(`https://api.adoptium.net/v3/binary/latest/21/ga/${os}/${arch}/jre/hotspot/normal/eclipse`, archive);
    const unpacked = path.join(DEV, "jre-unpacked");
    rmSync(unpacked, { recursive: true, force: true });
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", archive, "-C", unpacked]);
    renameSync(path.join(unpacked, readdirSync(unpacked)[0]), jre);
    rmSync(unpacked, { recursive: true, force: true });
    rmSync(archive, { force: true });
  }
  console.log("ready: npm run dev:local");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
