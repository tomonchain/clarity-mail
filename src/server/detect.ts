import { lookup, resolveMx } from "node:dns/promises";
import { PROVIDER_PRESETS } from "@/lib/providers";
import type { Provider } from "@/lib/types";

/** Server settings guessed from an email address. Every field stays editable in the form. */
export type DetectedSettings = {
  provider: Provider;
  /** Who hosts the mailbox, e.g. "Google Workspace" or "OVH". */
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** How it was found: the address domain, its MX record, Thunderbird's database, or a guess. */
  source: "domain" | "mx" | "autoconfig" | "guess";
  help?: string;
};

type Server = { host: string; port: number; secure: boolean };

const DOMAIN_PRESETS: Record<string, Provider> = {
  "gmail.com": "gmail",
  "googlemail.com": "gmail",
  "icloud.com": "icloud",
  "me.com": "icloud",
  "mac.com": "icloud",
};

type MxRule = {
  match: RegExp;
  label: string;
  provider?: Exclude<Provider, "imap">;
  imap?: Server;
  smtp?: Server;
  help?: string;
};

/** Mail hosts recognised from the domain's MX record (custom domains). */
const MX_RULES: MxRule[] = [
  { match: /(^|\.)(google|googlemail)\.com$/i, label: "Google Workspace", provider: "gmail" },
  { match: /(^|\.)(icloud|me)\.com$/i, label: "iCloud+ custom domain", provider: "icloud" },
  { match: /(^|\.)ovh\.net$/i, label: "OVH", provider: "ovh-mxplan" },
  {
    match: /(^|\.)(outlook\.com|office365\.us)$/i,
    label: "Microsoft 365 / Outlook",
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    help: "Microsoft often turns off password sign-in for IMAP. If sign-in fails, your admin must allow it.",
  },
  {
    match: /(^|\.)messagingengine\.com$/i,
    label: "Fastmail",
    imap: { host: "imap.fastmail.com", port: 993, secure: true },
    smtp: { host: "smtp.fastmail.com", port: 465, secure: true },
    help: "Use an app password from Fastmail settings.",
  },
  {
    match: /(^|\.)yahoodns\.net$/i,
    label: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, secure: true },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
    help: "Use an app password from Yahoo account security.",
  },
  {
    match: /(^|\.)gandi\.net$/i,
    label: "Gandi",
    imap: { host: "mail.gandi.net", port: 993, secure: true },
    smtp: { host: "mail.gandi.net", port: 465, secure: true },
  },
  {
    match: /(^|\.)infomaniak\.ch$/i,
    label: "Infomaniak",
    imap: { host: "mail.infomaniak.com", port: 993, secure: true },
    smtp: { host: "mail.infomaniak.com", port: 465, secure: true },
  },
];

function zoho(mx: string): MxRule | null {
  const tld = mx.match(/(^|\.)zoho\.([a-z.]+)$/i)?.[2];
  if (!tld) return null;
  return {
    match: /zoho/i,
    label: "Zoho Mail",
    imap: { host: `imap.zoho.${tld}`, port: 993, secure: true },
    smtp: { host: `smtp.zoho.${tld}`, port: 465, secure: true },
    help: "Turn on IMAP access in Zoho Mail settings first.",
  };
}

function fromPreset(provider: Exclude<Provider, "imap">, label: string, source: DetectedSettings["source"]): DetectedSettings {
  const p = PROVIDER_PRESETS[provider];
  return {
    provider,
    label,
    imapHost: p.imapHost,
    imapPort: p.imapPort,
    imapSecure: p.imapSecure,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecure: p.smtpSecure,
    source,
    help: p.help,
  };
}

function custom(label: string, imap: Server, smtp: Server, source: DetectedSettings["source"], help?: string): DetectedSettings {
  return {
    provider: "imap",
    label,
    imapHost: imap.host,
    imapPort: imap.port,
    imapSecure: imap.secure,
    smtpHost: smtp.host,
    smtpPort: smtp.port,
    smtpSecure: smtp.secure,
    source,
    help,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

async function mxHosts(domain: string): Promise<string[]> {
  const records = await withTimeout(resolveMx(domain), 4000);
  if (!records) return [];
  return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange.toLowerCase().replace(/\.$/, ""));
}

/** Parse a Thunderbird autoconfig XML document. Exported for tests. */
export function parseAutoconfig(xml: string, email: string): { label: string; imap: Server; smtp: Server } | null {
  const [local, domain] = email.split("@");
  const fill = (value: string) =>
    value
      .replaceAll("%EMAILDOMAIN%", domain ?? "")
      .replaceAll("%EMAILLOCALPART%", local ?? "")
      .replaceAll("%EMAILADDRESS%", email)
      .trim();
  const pick = (block: string, tag: string) => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i"))?.[1]?.trim() ?? "";
  const servers = (kind: "incomingServer" | "outgoingServer", type: string) =>
    [...xml.matchAll(new RegExp(`<${kind}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${kind}>`, "gi"))]
      .map((m) => {
        const block = m[1];
        const socket = pick(block, "socketType").toUpperCase();
        const host = fill(pick(block, "hostname"));
        const port = Number(pick(block, "port"));
        if (!host || !Number.isFinite(port) || port <= 0) return null;
        if (socket !== "SSL" && socket !== "STARTTLS") return null;
        return { host, port, secure: socket === "SSL" };
      })
      .filter((s): s is Server => s !== null)
      // Prefer implicit TLS, like the presets.
      .sort((a, b) => Number(b.secure) - Number(a.secure));
  const imap = servers("incomingServer", "imap")[0];
  const smtp = servers("outgoingServer", "smtp")[0];
  if (!imap || !smtp) return null;
  const label = fill(pick(xml, "displayShortName") || pick(xml, "displayName")) || domain || "Mail";
  return { label, imap, smtp };
}

async function autoconfig(lookupDomain: string, email: string) {
  const res = await withTimeout(
    fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(lookupDomain)}`, {
      signal: AbortSignal.timeout(5000),
    }),
    6000,
  );
  if (!res || !res.ok) return null;
  const text = await withTimeout(res.text(), 5000);
  return text ? parseAutoconfig(text, email) : null;
}

async function resolves(host: string) {
  return Boolean(await withTimeout(lookup(host), 3000));
}

/** The registrable part of a host, e.g. mx1.mail.example.co.uk -> example.co.uk (approximate). */
function baseDomain(host: string) {
  const parts = host.split(".");
  const tail = parts.slice(-2).join(".");
  if (parts.length > 2 && /^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(tail)) return parts.slice(-3).join(".");
  return tail;
}

/** Match an MX host list against the known mail hosts. Exported for tests. */
export function matchMx(hosts: string[]): DetectedSettings | null {
  for (const host of hosts) {
    for (const rule of [...MX_RULES, zoho(host)]) {
      if (!rule || !rule.match.test(host)) continue;
      if (rule.provider) return fromPreset(rule.provider, rule.label, "mx");
      if (rule.imap && rule.smtp) return custom(rule.label, rule.imap, rule.smtp, "mx", rule.help);
    }
  }
  return null;
}

export async function detectSettings(email: string): Promise<DetectedSettings> {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain || !domain.includes(".")) throw new Error("Enter a full email address.");

  const known = DOMAIN_PRESETS[domain];
  if (known && known !== "imap") return fromPreset(known, PROVIDER_PRESETS[known].label, "domain");

  const mx = await mxHosts(domain);
  const byMx = matchMx(mx);
  if (byMx) return byMx;

  const lookups = [domain, ...new Set(mx.map(baseDomain))].filter((d, i, all) => all.indexOf(d) === i);
  for (const candidate of lookups.slice(0, 3)) {
    const found = await autoconfig(candidate, email);
    if (found) return custom(found.label, found.imap, found.smtp, "autoconfig");
  }

  const imapHost = (await resolves(`imap.${domain}`)) ? `imap.${domain}` : `mail.${domain}`;
  const smtpHost = (await resolves(`smtp.${domain}`)) ? `smtp.${domain}` : `mail.${domain}`;
  return custom(
    domain,
    { host: imapHost, port: 993, secure: true },
    { host: smtpHost, port: 587, secure: false },
    "guess",
    "These servers are a guess. Check them against your host's help page before testing.",
  );
}
