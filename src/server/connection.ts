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

function tlsFor(host: string) {
  const insecure = host === "127.0.0.1" || host === "localhost" || process.env.SORTED_TLS_INSECURE === "1";
  return insecure ? { rejectUnauthorized: false } : undefined;
}

export function openImap(account: MailAccount) {
  return new ImapFlow({
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    auth: { user: account.username, pass: account.password },
    logger: false,
    tls: tlsFor(account.imapHost),
    clientInfo: { name: "Clarity Mail" },
  });
}

export async function withImap<T>(account: MailAccount, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = openImap(account);
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
    auth: { user: account.username, pass: account.password },
    tls: tlsFor(account.smtpHost),
  });
}

export async function testLogin(account: Omit<MailAccount, "id" | "label" | "aliases">) {
  const client = openImap({ ...account, id: "test", label: "test", aliases: [] });
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
