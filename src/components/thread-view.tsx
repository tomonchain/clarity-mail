"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Clock, Forward, Reply, Send, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MailBody } from "@/components/mail-body";
import { useCompose } from "@/components/compose";
import { SenderAvatar } from "@/components/sender-avatar";
import { SpaceDot } from "@/components/space-badge";
import { ThreadActions } from "@/components/thread-actions";
import { defaultIdentity, forwardDraft } from "@/lib/drafts";
import { fullDate } from "@/lib/format";
import { PRIORITY_THRESHOLD } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { Message, ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

function otherParty(thread: ScoredThread) {
  const mine = new Set([thread.account.email, ...thread.account.aliases].map((address) => address.toLowerCase()));
  for (const message of [...thread.messages].reverse()) {
    if (!mine.has(message.from.email.toLowerCase())) return message.from;
  }
  return thread.messages[thread.messages.length - 1].from;
}

function Composer({ thread }: { thread: ScoredThread }) {
  const { reply } = useStore();
  const { compose } = useCompose();
  const identities = [thread.account.email, ...thread.account.aliases];
  const [from, setFrom] = useState(() => defaultIdentity(thread));
  const [body, setBody] = useState("");
  const recipient = otherParty(thread);

  const send = async () => {
    if (!body.trim()) return;
    try {
      await reply(thread.id, from, body.trim());
      setBody("");
      toast.success(`Reply sent from ${from}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    }
  };

  return (
    <div className="mt-6 overflow-hidden rounded-xl bg-card shadow-card transition-shadow focus-within:shadow-float">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2 text-xs text-muted-foreground">
        <Reply className="size-3.5" />
        <span>
          Reply to <span className="font-medium text-foreground">{recipient.name}</span> from
        </span>
        <Select
          value={from}
          onValueChange={(v) => v && setFrom(v)}
          items={Object.fromEntries(identities.map((i) => [i, i]))}
        >
          <SelectTrigger
            size="sm"
            className="h-7 border-0 bg-transparent px-1.5 text-xs shadow-none hover:bg-accent dark:bg-transparent"
            aria-label="Send from"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {identities.map((i) => (
              <SelectItem key={i} value={i} className="text-xs">
                {i}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        id="reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={`Write to ${recipient.name.split(" ")[0]}…`}
        className="min-h-28 resize-y rounded-none border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="hidden pl-1 text-xs text-muted-foreground sm:inline">
          <kbd className="font-mono">⌘ ↵</kbd> to send
        </span>
        <Button size="sm" variant="ghost" onClick={() => compose(forwardDraft(thread))} className="ml-auto">
          <Forward />
          Forward
        </Button>
        <Button size="sm" variant="brand" className="px-3" onClick={send} disabled={!body.trim()}>
          <Send />
          Send
        </Button>
      </div>
    </div>
  );
}

function MessageCard({
  message,
  collapsed,
  onToggle,
}: {
  message: Message;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left shadow-card transition-colors hover:bg-accent/50"
      >
        <SenderAvatar name={message.from.name} email={message.from.email} size="sm" />
        <span className="shrink-0 text-sm font-medium">{message.from.name}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{message.body.slice(0, 160)}</span>
        <time className="shrink-0 text-xs text-muted-foreground">{fullDate(message.sentAt)}</time>
      </button>
    );
  }
  return (
    <section className="animate-fade-up rounded-xl bg-card shadow-card">
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <SenderAvatar name={message.from.name} email={message.from.email} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold">{message.from.name}</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">{message.from.email}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">to {message.to.join(", ")}</p>
        </div>
        <time className="shrink-0 pt-0.5 text-xs text-muted-foreground">{fullDate(message.sentAt)}</time>
      </header>
      <div className="px-5 pb-5">
        <MailBody body={message.body} html={message.html} sender={message.from.email} />
      </div>
    </section>
  );
}

function Conversation({ thread }: { thread: ScoredThread }) {
  const count = thread.messages.length;
  // Long threads open on the latest messages; earlier ones fold into one-line cards.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(thread.messages.slice(Math.max(0, count - 2)).map((m) => m.id)),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-3">
      {thread.messages.map((m) => (
        <MessageCard key={m.id} message={m} collapsed={!open.has(m.id)} onToggle={() => toggle(m.id)} />
      ))}
    </div>
  );
}

const STATUS_BADGES = {
  done: { icon: Archive, label: "Archived", tone: "bg-secondary" },
  snoozed: { icon: Clock, label: "Snoozed", tone: "bg-secondary" },
  trash: { icon: Trash2, label: "In Trash", tone: "bg-destructive/10 text-destructive" },
  spam: { icon: ShieldAlert, label: "Spam", tone: "bg-warning/15 text-amber-700 dark:text-warning" },
} as const;

function StatusBadge({ status }: { status: Exclude<ScoredThread["status"], "inbox"> }) {
  const badge = STATUS_BADGES[status];
  const Icon = badge.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", badge.tone)}>
      <Icon className="size-3" />
      {badge.label}
    </span>
  );
}

export function ThreadView({ thread }: { thread: ScoredThread }) {
  const { spaces } = useStore();
  const space = spaces.find((s) => s.id === thread.space);
  const reasons = thread.reasons.filter((r) => Math.abs(r.points) >= 10).slice(0, 3);
  const important = thread.score >= PRIORITY_THRESHOLD;
  const reading = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reading.current?.scrollTo({ top: 0 });
  }, [thread.id]);

  return (
    <article className="flex h-full min-h-0 flex-col bg-surface">
      <div className="desktop-drag flex h-12 shrink-0 items-center gap-2 border-b bg-surface/85 pr-12 pl-5 backdrop-blur-xl lg:pr-4 in-[.desktop-app]:lg:h-14">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          <SpaceDot space={space} />
          <span className="font-medium text-foreground/80">{space?.name}</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate">{thread.account.email}</span>
        </span>
        <ThreadActions thread={thread} className="ml-auto" />
      </div>

      <div ref={reading} className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-5 pt-8 pb-16 md:px-8">
          <div className="mb-6 space-y-3">
            <h2 className="text-[1.65rem] leading-tight font-semibold tracking-tight text-balance">
              {thread.subject || "(no subject)"}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {thread.status !== "inbox" && <StatusBadge status={thread.status} />}
              {reasons.map((r) => (
                <span
                  key={r.label}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs",
                    important && r.points > 0 ? "bg-brand-soft font-medium text-brand" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {r.label}
                </span>
              ))}
              {thread.messages.length > 1 && (
                <span className="text-xs text-muted-foreground">{thread.messages.length} messages</span>
              )}
            </div>
          </div>

          {thread.summary && (
            <div className="mb-5 flex gap-3 rounded-xl border border-brand/15 bg-brand-soft px-4 py-3 text-sm leading-relaxed">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-brand" />
              <p>{thread.summary}</p>
            </div>
          )}

          <Conversation key={`conversation-${thread.id}`} thread={thread} />

          <Composer key={`composer-${thread.id}`} thread={thread} />
        </div>
      </div>
    </article>
  );
}
