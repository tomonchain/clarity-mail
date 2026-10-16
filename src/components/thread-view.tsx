"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
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
import { SpaceDot } from "@/components/space-badge";
import { ThreadActions } from "@/components/thread-actions";
import { fullDate } from "@/lib/format";
import { whyLine } from "@/lib/priority";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";

function defaultIdentity(thread: ScoredThread): string {
  const identities = [thread.account.email, ...thread.account.aliases];
  for (const m of [...thread.messages].reverse()) {
    const hit = m.to.find((addr) => identities.includes(addr.toLowerCase()));
    if (hit) return hit;
    if (identities.includes(m.from.email.toLowerCase())) return m.from.email;
  }
  return thread.account.email;
}

function otherParty(thread: ScoredThread) {
  const mine = new Set([thread.account.email, ...thread.account.aliases].map((address) => address.toLowerCase()));
  for (const message of [...thread.messages].reverse()) {
    if (!mine.has(message.from.email.toLowerCase())) return message.from;
  }
  return thread.messages[thread.messages.length - 1].from;
}

function Composer({ thread }: { thread: ScoredThread }) {
  const { reply } = useStore();
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
    <div className="border-t border-border/80 pt-6">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>From</span>
        <Select
          value={from}
          onValueChange={(v) => v && setFrom(v)}
          items={Object.fromEntries(identities.map((i) => [i, i]))}
        >
          <SelectTrigger size="sm" className="text-xs" aria-label="Send from">
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
        <span>to {recipient.name}</span>
      </div>
      <Textarea
        id="reply-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={`Reply to ${recipient.name.split(" ")[0]}…`}
        className="min-h-24 resize-y border-0 px-1 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="hidden text-xs text-muted-foreground sm:inline">⌘/Ctrl + Enter to send</span>
        <Button size="sm" onClick={send} disabled={!body.trim()} className="ml-auto">
          <Send />
          Send
        </Button>
      </div>
    </div>
  );
}

export function ThreadView({ thread }: { thread: ScoredThread }) {
  const { spaces } = useStore();
  const space = spaces.find((s) => s.id === thread.space);
  const why = whyLine(thread.reasons);
  const reading = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reading.current?.scrollTo({ top: 0 });
  }, [thread.id]);

  return (
    <article className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 space-y-4 px-6 py-8 md:px-10">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <SpaceDot space={space} className="size-1.5" />
          {space?.name}
          <span>·</span>
          {thread.account.email}
          {thread.status !== "inbox" && (
            <>
              <span>·</span>
              {thread.status === "done" ? "Done" : "Snoozed"}
            </>
          )}
        </p>
        <h2 className="max-w-2xl text-2xl font-medium tracking-tight">{thread.subject}</h2>
        {why && <p className="text-sm text-muted-foreground">{why}</p>}
        <ThreadActions thread={thread} />
      </header>

      <div ref={reading} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-16 md:px-10">
        <div className="max-w-2xl">
        {thread.summary && (
          <p className="mb-8 text-sm leading-relaxed text-muted-foreground">{thread.summary}</p>
        )}

        {thread.messages.map((m) => (
          <section key={m.id} className="border-t border-border/80 py-6">
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <p className="min-w-0 truncate text-sm">
                <span className="font-medium">{m.from.name}</span>
                <span className="text-muted-foreground"> to {m.to.join(", ")}</span>
              </p>
              <time className="shrink-0 text-xs text-muted-foreground">{fullDate(m.sentAt)}</time>
            </div>
            <MailBody body={m.body} html={m.html} />
          </section>
        ))}

        <Composer key={thread.id} thread={thread} />
        </div>
      </div>
    </article>
  );
}
