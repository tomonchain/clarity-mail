/**
 * Cut a release: npm run release -- <version> [--publish]
 *
 *   1. Checks the tree is clean, on main and up to date with origin.
 *   2. Dates the version's notes in src/lib/releases.ts (write them first, with date: null).
 *   3. Sets the version in every package.json and lockfile, and writes CHANGELOG.md from the notes.
 *   4. Commits "Release <version>" and tags v<version>.
 *   5. Builds the Mac app for Apple Silicon and Intel.
 *   6. With --publish: pushes, then creates a draft GitHub release with both zips.
 *      Nothing is public until you press Publish on GitHub.
 *
 * Without --publish it stops after the build and prints what is left to do.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareVersions, RELEASES, RELEASES_REPO, type Release } from "../src/lib/releases";

const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"))?.replace(/^v/, "");
const publish = args.includes("--publish");
const skipBuild = args.includes("--skip-build");
const repo = process.env.CLARITY_RELEASES_REPO?.trim() || RELEASES_REPO;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function git(...a: string[]) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
}

function run(command: string, a: string[], env: Record<string, string> = {}) {
  console.log(`\n$ ${command} ${a.join(" ")}`);
  const result = spawnSync(command, a, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`${command} ${a[0] ?? ""} failed`);
}

function readJson(file: string) {
  return JSON.parse(readFileSync(path.join(root, file), "utf8")) as Record<string, unknown> & {
    version?: string;
    packages?: Record<string, { version?: string }>;
  };
}

function writeJson(file: string, data: unknown) {
  writeFileSync(path.join(root, file), `${JSON.stringify(data, null, 2)}\n`);
}

const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD, local time

function changelog(releases: Release[]) {
  const out = ["# Changelog", ""];
  for (const r of releases) {
    if (!r.date) continue;
    out.push(`## ${r.version} — ${r.date}`, "");
    if (r.intro) out.push(r.intro, "");
    for (const s of r.sections) out.push(`### ${s.title}`, "", ...s.items.map((i) => `- ${i}`), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function title(v: string) {
  return `Clarity Mail ${v.replace(/-([a-z]+)\.(\d+)$/, " $1 $2")}`;
}

function releaseBody(r: Release) {
  const notes = r.sections.map((s) => [`### ${s.title}`, "", ...s.items.map((i) => `- ${i}`)].join("\n")).join("\n\n");
  return `${r.intro ?? ""}

## Installer sur Mac

1. Téléchargez le zip qui correspond à votre Mac (menu Pomme → À propos de ce Mac) :
   - **Clarity-Mail-Apple-Silicon.zip** pour une puce M1, M2, M3 ou M4
   - **Clarity-Mail-Intel.zip** pour un processeur Intel
2. Dézippez, puis glissez « Clarity Mail.app » dans Applications, à la place de l'ancienne. Vos mails et réglages sont conservés.
3. Premier lancement : **clic droit sur l'app → Ouvrir → Ouvrir**. L'app n'est pas notarisée par Apple, c'est normal pour cette beta.
   Si macOS dit que l'app est endommagée : \`xattr -dr com.apple.quarantine "/Applications/Clarity Mail.app"\` dans Terminal.

## What's new

${notes}

Le détail des versions est dans [CHANGELOG.md](https://github.com/${repo}/blob/main/CHANGELOG.md).
`;
}

// ---------- checks ----------

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  fail("Usage: npm run release -- <version> [--publish]   e.g. npm run release -- 1.0.0-beta.2");
}
const pkg = readJson("package.json");
const current = pkg.version ?? "0.0.0";
if (compareVersions(version, current) <= 0) fail(`${version} is not newer than ${current}.`);

const notes = RELEASES.find((r) => r.version === version);
if (!notes || notes.sections.every((s) => s.items.length === 0)) {
  fail(`No notes for ${version} in src/lib/releases.ts. Add them at the top of RELEASES, with date: null.`);
}
if (git("status", "--porcelain")) fail("The working tree has uncommitted changes. Commit or stash them first.");
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Releases are cut from main.");
run("git", ["fetch", "origin", "main", "--tags", "--quiet"]);
if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) fail("main is not in sync with origin/main. Pull or push first.");
if (git("tag", "--list", `v${version}`)) fail(`Tag v${version} already exists.`);

// ---------- version, notes, changelog ----------

const releasesFile = path.join(root, "src/lib/releases.ts");
const source = readFileSync(releasesFile, "utf8");
const dated = source.replace(
  new RegExp(`(version: "${version.replace(/\./g, "\\.")}",\\s*date: )null`),
  `$1"${today}"`,
);
if (dated === source && !notes.date) fail(`Could not date ${version} in src/lib/releases.ts.`);
writeFileSync(releasesFile, dated);
notes.date ??= today;

for (const file of ["package.json", "desktop/package.json", "mobile/package.json"]) {
  if (!existsSync(path.join(root, file))) continue;
  const data = readJson(file);
  data.version = version;
  writeJson(file, data);
}
for (const file of ["package-lock.json", "desktop/package-lock.json", "mobile/package-lock.json"]) {
  if (!existsSync(path.join(root, file))) continue;
  const data = readJson(file);
  data.version = version;
  if (data.packages?.[""]) data.packages[""].version = version;
  writeJson(file, data);
}
writeFileSync(path.join(root, "CHANGELOG.md"), changelog(RELEASES));
const bodyFile = path.join(root, "desktop/dist/RELEASE_NOTES.md");

run("npm", ["run", "typecheck"]);
run("git", ["add", "-A"]);
run("git", ["commit", "-m", `Release ${version}`]);
run("git", ["tag", "-a", `v${version}`, "-m", `Clarity Mail ${version}`]);

// ---------- build ----------

if (!skipBuild) run("node", ["desktop/build.mjs"], { CLARITY_ALL_ARCHES: "1" });
writeFileSync(bodyFile, releaseBody(notes));
const zips = ["Clarity-Mail-Apple-Silicon.zip", "Clarity-Mail-Intel.zip"].map((z) => path.join(root, "desktop/dist", z));
const missing = zips.filter((z) => !existsSync(z));

// ---------- publish ----------

if (!publish) {
  console.log(`
✓ ${version} is committed and tagged locally, and the Mac app is built.

Left to do:
  git push origin main --follow-tags
  gh release create v${version} --repo ${repo} --draft${version.includes("-") ? " --prerelease" : ""} \\
    --title "${title(version)}" --notes-file desktop/dist/RELEASE_NOTES.md \\
    desktop/dist/Clarity-Mail-Apple-Silicon.zip desktop/dist/Clarity-Mail-Intel.zip

Or run again next time with --publish. To undo: git tag -d v${version} && git reset --hard HEAD~1
`);
  process.exit(0);
}

if (missing.length) fail(`Missing build output: ${missing.join(", ")}`);
run("git", ["push", "origin", "main", "--follow-tags"]);
run("gh", [
  "release",
  "create",
  `v${version}`,
  "--repo",
  repo,
  "--draft",
  ...(version.includes("-") ? ["--prerelease"] : []),
  "--title",
  title(version),
  "--notes-file",
  bodyFile,
  ...zips,
]);
console.log(`\n✓ Draft release v${version} created. Review it on GitHub, then press Publish.\n`);
