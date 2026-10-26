import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";
import { APP_VERSION, compareVersions, RELEASES_REPO } from "@/lib/releases";

// Whether a newer Clarity is out, from the GitHub releases of CLARITY_RELEASES_REPO.
// A private repository needs CLARITY_RELEASES_TOKEN (read-only) on the server.

export type UpdateInfo = {
  current: string;
  checkedAt: number;
  latest: { version: string; url: string; publishedAt: string | null; download: string | null } | null;
  error: "unreachable" | "not-found" | null;
};

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  draft: boolean;
  published_at: string | null;
  assets: { name: string; browser_download_url: string }[];
};

const TTL = 6 * 60 * 60_000;
let cached: UpdateInfo | null = null;

function repo() {
  const name = process.env.CLARITY_RELEASES_REPO?.trim() || RELEASES_REPO;
  return /^[\w.-]+\/[\w.-]+$/.test(name) ? name : null;
}

async function check(): Promise<UpdateInfo> {
  const base: UpdateInfo = { current: APP_VERSION, checkedAt: Date.now(), latest: null, error: null };
  const name = repo();
  if (!name) return { ...base, error: "not-found" };
  const token = process.env.CLARITY_RELEASES_TOKEN?.trim();
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${name}/releases?per_page=10`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Clarity-Mail",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    return { ...base, error: "unreachable" };
  }
  // GitHub answers 404 for a private repository without a token.
  if (res.status === 404) return { ...base, error: "not-found" };
  if (!res.ok) return { ...base, error: "unreachable" };
  const releases = ((await res.json()) as GitHubRelease[]).filter((r) => !r.draft);
  const newest = releases.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  if (!newest) return base;
  // The zip for this machine's chip: the Mac app's server runs on the same Mac.
  const chip = process.arch === "arm64" ? "Apple-Silicon" : "Intel";
  const asset = newest.assets.find((a) => a.name.includes(chip) && a.name.endsWith(".zip"));
  return {
    ...base,
    latest: {
      version: newest.tag_name.replace(/^v/, ""),
      url: newest.html_url,
      publishedAt: newest.published_at,
      // A private repository's files only download when signed in to GitHub: link the release page instead.
      download: token ? null : (asset?.browser_download_url ?? null),
    },
  };
}

export async function GET(request: Request) {
  try {
    await prepareDb();
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!(await readSession())) return new Response(null, { status: 401 });
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (force || !cached || Date.now() - cached.checkedAt > TTL) cached = await check();
  return Response.json(cached);
}
