"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PenSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { signatureFor, withSignature } from "@/lib/drafts";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

/** The signature that will go under the message, and a way to leave it off this once. */
export function SignatureNote({
  signature,
  included,
  onToggle,
  className,
}: {
  signature: string;
  included: boolean;
  onToggle: () => void;
  className?: string;
}) {
  if (!signature) return null;
  return (
    <div className={cn("group/sig flex items-start gap-3 text-[13px] leading-relaxed", className)}>
      <p className={cn("min-w-0 flex-1 whitespace-pre-line text-muted-foreground", !included && "line-through opacity-50")}>
        <span className="font-mono text-xs">-- </span>
        {"\n"}
        {signature}
      </p>
      <button type="button" onClick={onToggle} className="shrink-0 text-xs text-muted-foreground hover:text-foreground">
        {included ? "Leave off" : "Add signature"}
      </button>
    </div>
  );
}

export type Draft = { from?: string; to?: string; cc?: string; subject?: string; body?: string };

type ComposeApi = { compose: (draft?: Draft) => void };

const ComposeContext = createContext<ComposeApi | null>(null);

export function useCompose() {
  const ctx = useContext(ComposeContext);
  if (!ctx) throw new Error("useCompose must be used inside ComposeProvider");
  return ctx;
}

function ComposeForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const { accounts, sendMail } = useStore();
  const identities = accounts.flatMap((a) => [a.email, ...a.aliases]);
  const [from, setFrom] = useState(draft.from && identities.includes(draft.from) ? draft.from : identities[0] ?? "");
  const [to, setTo] = useState(draft.to ?? "");
  const [cc, setCc] = useState(draft.cc ?? "");
  const [showCc, setShowCc] = useState(Boolean(draft.cc));
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [sending, setSending] = useState(false);
  const [signed, setSigned] = useState(true);
  const signature = signatureFor(accounts, from);
  const ready = from && to.trim() && body.trim() && !sending;

  const send = async () => {
    if (!ready) return;
    setSending(true);
    try {
      await sendMail({ from, to, cc: showCc ? cc : undefined, subject, body: signed ? withSignature(body, signature) : body });
      toast.success(`Sent from ${from}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  };

  if (identities.length === 0) {
    return <p className="text-sm text-muted-foreground">Add a mailbox in Settings before writing a message.</p>;
  }

  const bare =
    "h-10 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent";

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <div className="overflow-hidden rounded-xl border bg-card shadow-soft">
        <div className="divide-y px-3.5">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">From</span>
            <Select value={from} onValueChange={(v) => v && setFrom(v)} items={Object.fromEntries(identities.map((i) => [i, i]))}>
              <SelectTrigger
                className="h-10 w-full rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 dark:bg-transparent dark:hover:bg-transparent"
                aria-label="Send from"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {identities.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">To</span>
            <Input
              autoFocus
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="name@example.com, other@example.com"
              aria-label="To"
              className={bare}
            />
            {!showCc && (
              <Button type="button" variant="ghost" size="xs" onClick={() => setShowCc(true)}>
                Cc
              </Button>
            )}
          </div>
          {showCc && (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">Cc</span>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Cc" className={bare} />
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs font-medium text-muted-foreground">Subject</span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              aria-label="Subject"
              className={`${bare} font-medium`}
            />
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label="Message"
          placeholder="Write your message…"
          className="min-h-64 resize-y rounded-none border-0 border-t bg-transparent px-3.5 py-3 text-[15px] leading-relaxed shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <SignatureNote
          signature={signature}
          included={signed}
          onToggle={() => setSigned((v) => !v)}
          className="border-t px-3.5 py-2.5"
        />
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:inline">
          <kbd className="font-mono">⌘ ↵</kbd> to send
        </span>
        <Button type="submit" variant="brand" className="h-9 px-4" disabled={!ready}>
          <Send />
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}

export function ComposeProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [key, setKey] = useState(0);
  const compose = useCallback((next?: Draft) => {
    setDraft(next ?? {});
    setKey((k) => k + 1);
  }, []);
  const api = useMemo(() => ({ compose }), [compose]);

  // "c" (outside text fields) or ⌘N opens a new message from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const cmdN = (event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "n";
      const plainC = !event.metaKey && !event.ctrlKey && !event.altKey && event.key === "c" && !typing;
      if (!cmdN && !plainC) return;
      if (document.querySelector("[role=dialog]")) return;
      event.preventDefault();
      compose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compose]);

  return (
    <ComposeContext.Provider value={api}>
      {children}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="gap-5 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold tracking-tight">
              {draft?.subject?.startsWith("Fwd:") ? "Forward" : "New message"}
            </DialogTitle>
          </DialogHeader>
          {draft && <ComposeForm key={key} draft={draft} onDone={() => setDraft(null)} />}
        </DialogContent>
      </Dialog>
    </ComposeContext.Provider>
  );
}

export function ComposeButton({ onClick }: { onClick?: () => void }) {
  const { compose } = useCompose();
  return (
    <Button
      className="h-9 w-full justify-start gap-2 rounded-lg px-3"
      onClick={() => {
        onClick?.();
        compose();
      }}
    >
      <PenSquare />
      <span className="flex-1 text-left">New message</span>
      <kbd className="rounded border border-primary-foreground/20 px-1.5 font-mono text-[10px] text-primary-foreground/70">
        C
      </kbd>
    </Button>
  );
}
