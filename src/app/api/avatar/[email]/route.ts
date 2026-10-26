import { createHash } from "node:crypto";
import { readSession } from "@/server/http";
import { prepareDb } from "@/server/snapshot";

// Photos for a sender: their Gravatar, else the icon of the company they write from.
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

async function lookup(email: string): Promise<Picture> {
  const hash = createHash("sha256").update(email).digest("hex");
  const gravatar = await fetchImage(`https://gravatar.com/avatar/${hash}?s=160&d=404`);
  if (gravatar) return gravatar;
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

function remember(email: string, picture: Picture) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(email, { picture, at: Date.now() });
}

export async function GET(_request: Request, context: { params: Promise<{ email: string }> }) {
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

  const known = cache.get(email);
  let picture = known && (known.picture || Date.now() - known.at < MISS_TTL) ? known.picture : undefined;
  if (picture === undefined) {
    let job = pending.get(email);
    if (!job) {
      job = lookup(email).finally(() => pending.delete(email));
      pending.set(email, job);
    }
    picture = await job;
    remember(email, picture);
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
