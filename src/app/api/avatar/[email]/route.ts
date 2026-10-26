import { createHash } from "node:crypto";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

// Pictures for a sender, in two kinds: ?kind=photo is their Gravatar, ?kind=logo the icon
// of the company they write from. The list shows a person's photo, else their initials with
// the company icon as a small badge, and a company's icon full size for automated mail.
// Looked up by the server, so the sender's site never sees the reader's address or IP,
// and only from fixed hosts: an address can't steer the server to another machine.

const TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon"]);
const MAX_BYTES = 256 * 1024;
// A company icon for these would put the Gmail logo on every friend.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com", "outlook.com", "outlook.fr", "hotmail.com",
  "hotmail.fr", "live.com", "live.fr", "msn.com", "yahoo.com", "yahoo.fr", "ymail.com", "aol.com", "proton.me",
  "protonmail.com", "pm.me", "gmx.com", "gmx.fr", "gmx.de", "web.de", "mail.com", "orange.fr", "wanadoo.fr", "free.fr",
  "sfr.fr", "neuf.fr", "laposte.net", "bbox.fr", "numericable.fr", "hey.com", "fastmail.com", "zoho.com", "yandex.com",
  "tutanota.com", "duck.com",
]);
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

type Picture = { data: Uint8Array; type: string } | null;
const cache = new Map<string, { picture: Picture; at: number }>();
// A miss may be a network blip: look again after a while.
const MISS_TTL = 60 * 60_000;
const pending = new Map<string, Promise<Picture>>();
const CACHE_SIZE = 1000;

async function fetchImage(url: string): Promise<Picture> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { accept: "image/*" } });
    const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!res.ok || !TYPES.has(type)) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    return data.length > 0 && data.length <= MAX_BYTES ? { data, type } : null;
  } catch {
    return null;
  }
}

/** notifications.github.com → github.com; mail.example.co.uk → example.co.uk. */
function baseDomain(domain: string) {
  const labels = domain.split(".");
  const keep = labels.length > 2 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

type Kind = "photo" | "logo";

async function lookup(email: string, kind: Kind): Promise<Picture> {
  if (kind === "photo") {
    const hash = createHash("sha256").update(email).digest("hex");
    return fetchImage(`https://gravatar.com/avatar/${hash}?s=160&d=404`);
  }
  const domain = email.split("@")[1];
  if (PERSONAL_DOMAINS.has(domain) || PERSONAL_DOMAINS.has(baseDomain(domain))) return null;
  for (const host of new Set([domain, baseDomain(domain)])) {
    const icon =
      (await fetchImage(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`)) ??
      (await fetchImage(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`));
    if (icon) return icon;
  }
  return null;
}

function remember(key: string, picture: Picture) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, { picture, at: Date.now() });
}

export async function GET(request: Request, context: { params: Promise<{ email: string }> }) {
  try {
    await prepareDb();
  } catch {
    return new Response(null, { status: 503 });
  }
  if (!(await readSession())) return new Response(null, { status: 401 });
  const email = decodeURIComponent((await context.params).email).trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@/]+@([a-z0-9-]+\.)+[a-z]{2,}$/.test(email)) {
    return new Response(null, { status: 404 });
  }

  const kind: Kind = new URL(request.url).searchParams.get("kind") === "logo" ? "logo" : "photo";
  const key = `${kind}:${email}`;
  const known = cache.get(key);
  let picture = known && (known.picture || Date.now() - known.at < MISS_TTL) ? known.picture : undefined;
  if (picture === undefined) {
    let job = pending.get(key);
    if (!job) {
      job = lookup(email, kind).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    picture = await job;
    remember(key, picture);
  }

  if (!picture) {
    // The browser remembers the miss too, so the list doesn't ask again on every render.
    return new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=86400" } });
  }
  return new Response(new Uint8Array(picture.data), {
    headers: {
      "Content-Type": picture.type,
      "Content-Length": String(picture.data.length),
      "Cache-Control": "private, max-age=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
