import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { decryptSecret } from "./crypto";
import { getDb, type AccountRow } from "./db";

export type MailAccount = {
  id: string;
  label: string;
  email: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  aliases: string[];
};

export function mailAccount(row: AccountRow): MailAccount {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    username: row.username,
    password: decryptSecret(row.secret),
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure === 1,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure === 1,
    aliases: JSON.parse(row.aliases) as string[],
  };
}

export function loadAccount(id: string): MailAccount {
  const row = getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) throw new Error("Account not found.");
  return mailAccount(row);
}

function isLocalHost(host: string) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Mail always travels over TLS 1.2 or newer, with the server's certificate
 * checked. On ports without implicit TLS (143, 587), STARTTLS is required:
 * a server or a network that strips it gets no password and no mail.
 */
function tlsFor(host: string) {
  if (isLocalHost(host) || process.env.SORTED_TLS_INSECURE === "1") return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, minVersion: "TLSv1.2" as const, servername: host };
}

export function openImap(account: MailAccount, extra: { maxIdleTime?: number; autoIdleDelay?: number } = {}) {
  return new ImapFlow({
    ...extra,
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    doSTARTTLS: account.imapSecure || isLocalHost(account.imapHost) ? undefined : true,
    auth: { user: account.username, pass: account.password },
    logger: false,
    tls: tlsFor(account.imapHost),
    clientInfo: { name: "Clarity Mail" },
  });
}

export async function withImap<T>(account: MailAccount, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = openImap(account);
  // Without a listener, a socket timeout would surface as an uncaught exception.
  client.on("error", (err: unknown) => {
    console.error("[imap]", account.email, err instanceof Error ? err.message : err);
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

export function smtpTransport(account: MailAccount) {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure,
    requireTLS: !account.smtpSecure && !isLocalHost(account.smtpHost),
    auth: { user: account.username, pass: account.password },
    tls: tlsFor(account.smtpHost),
  });
}

export async function testLogin(account: Omit<MailAccount, "id" | "label" | "aliases">) {
  const client = openImap({ ...account, id: "test", label: "test", aliases: [] });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.list();
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}
