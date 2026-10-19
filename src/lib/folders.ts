import { Archive, Clock, Send, ShieldAlert, Star, Trash2, type LucideIcon } from "lucide-react";

/** Views of the inbox itself, shown as pills above the list. */
export type InboxFilter = "priority" | "recent" | "reply" | "noise";

/** Views of everything else, linked from the sidebar. "done" is the Archive. */
export type Folder = "starred" | "snoozed" | "sent" | "done" | "spam" | "trash";

export type InboxTab = InboxFilter | Folder;

export const INBOX_FILTERS: { id: InboxFilter; label: string }[] = [
  { id: "priority", label: "Priority" },
  { id: "recent", label: "Recent" },
  { id: "reply", label: "To answer" },
  { id: "noise", label: "Noise" },
];

export const FOLDERS: { id: Folder; label: string; icon: LucideIcon; empty: string; hint: string }[] = [
  { id: "starred", label: "Starred", icon: Star, empty: "No starred mail", hint: "Press s on a conversation to star it." },
  { id: "snoozed", label: "Snoozed", icon: Clock, empty: "Nothing snoozed", hint: "Snoozed conversations come back when it's time." },
  { id: "sent", label: "Sent", icon: Send, empty: "Nothing sent yet", hint: "Conversations you wrote in show up here." },
  { id: "done", label: "Archive", icon: Archive, empty: "The archive is empty", hint: "Press e to archive a conversation." },
  { id: "spam", label: "Spam", icon: ShieldAlert, empty: "No spam", hint: "Press ! to report a conversation as spam." },
  { id: "trash", label: "Trash", icon: Trash2, empty: "Trash is empty", hint: "Deleted conversations wait here." },
];

export const ALL_TABS: InboxTab[] = [...INBOX_FILTERS.map((f) => f.id), ...FOLDERS.map((f) => f.id)];

export function folderOf(tab: string | null | undefined) {
  return FOLDERS.find((f) => f.id === tab);
}
