export type SpaceId = string;

export type Space = {
  id: SpaceId;
  name: string;
  description: string;
  color: string;
  vips: string[];
  focusHours?: { start: number; end: number; weekdaysOnly: boolean };
  slaHours?: number;
};

export type Provider = "icloud" | "ovh-mxplan" | "imap";

export type Account = {
  id: string;
  label: string;
  email: string;
  provider: Provider;
  imapHost: string;
  imapPort?: number;
  smtpHost: string;
  smtpPort?: number;
  defaultSpace: SpaceId;
  aliases: string[];
  lastSyncAt?: number | null;
  syncError?: string | null;
  syncing?: boolean;
};

export type Category =
  | "needs-reply"
  | "fyi"
  | "calendar"
  | "receipt"
  | "notification"
  | "newsletter";

export type Person = { name: string; email: string };

export type Message = {
  id: string;
  from: Person;
  to: string[];
  sentAt: number;
  body: string;
  /** Sanitized HTML, when the message had an HTML part. */
  html?: string;
};

export type ThreadStatus = "inbox" | "done" | "snoozed";

export type Thread = {
  id: string;
  accountId: string;
  subject: string;
  snippet: string;
  /** One-line summary from AI triage, when a provider key is configured. */
  summary?: string;
  summarySource?: "ai" | "rules";
  messages: Message[];
  category: Category;
  unread: boolean;
  starred: boolean;
  status: ThreadStatus;
  snoozedUntil?: number;
  /** Set when the last message was sent by you and you're waiting on an answer. */
  awaitingReply?: boolean;
  /** Manual space override set from the UI ("Move to…"). */
  spaceOverride?: SpaceId;
};

export type RuleField = "to" | "fromDomain" | "fromEmail" | "subject";

export type RoutingRule = {
  id: string;
  field: RuleField;
  value: string;
  space?: SpaceId;
  category?: Category;
};

export type PriorityReason = { label: string; points: number };

export type ScoredThread = Thread & {
  space: SpaceId;
  account: Account;
  score: number;
  reasons: PriorityReason[];
  lastActivity: number;
};
