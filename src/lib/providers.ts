import type { Provider } from "./types";

export type ProviderPreset = {
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  help: string;
};

export const PROVIDER_PRESETS: Record<Provider, ProviderPreset> = {
  icloud: {
    label: "iCloud",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false,
    help: "Use an app-specific password from appleid.apple.com, not your Apple ID password.",
  },
  gmail: {
    label: "Gmail",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    help: "Use an app password from myaccount.google.com/apppasswords (needs 2-step verification). Works for Google Workspace too.",
  },
  "ovh-mxplan": {
    label: "OVH MX Plan",
    imapHost: "ssl0.ovh.net",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "ssl0.ovh.net",
    smtpPort: 465,
    smtpSecure: true,
    help: "Use the mailbox password from the OVH control panel (Web Cloud, then Emails).",
  },
  imap: {
    label: "Other IMAP",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    help: "Any provider that speaks IMAP and SMTP.",
  },
};
