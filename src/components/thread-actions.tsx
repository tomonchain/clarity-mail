"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  Archive,
  ArrowRightLeft,
  Clock,
  Forward,
  Inbox,
  MailOpen,
  Mail,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useCompose } from "@/components/compose";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpaceDot } from "@/components/space-badge";
import { forwardDraft } from "@/lib/drafts";
import { snoozeOptions } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ScoredThread, ThreadStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

function describe(list: ScoredThread[]) {
  return list.length === 1 ? list[0].subject : `${list.length} conversations`;
}

// The last change that can be undone, shared by every view so ⌘Z works anywhere.
let lastUndo: { label: string; run: () => void } | null = null;

export function useThreadCommands() {
  const store = useStore();
  const { compose } = useCompose();

  /** Keep a copy of the threads as they are now, so the change can be undone. */
  const remember = (list: ScoredThread[], label: string) => {
    const ids = new Set(list.map((t) => t.id));
    const snapshot = store.threads.filter((t) => ids.has(t.id));
    if (snapshot.length === 0) return undefined;
    const undo = () => {
      store.restoreThreads(snapshot);
      if (lastUndo?.run === undo) lastUndo = null;
    };
    lastUndo = { label, run: undo };
    return { label: "Undo", onClick: undo };
  };

  /** Change the status of one or more threads and offer to undo it. */
  const file = (list: ScoredThread[], status: ThreadStatus, message: string, until?: number) => {
    if (list.length === 0) return;
    const action = remember(list, message);
    store.bulk(
      list.map((t) => t.id),
      { kind: "status", status, snoozedUntil: until },
    );
    toast(message, { description: describe(list), action });
  };

  const many = (t: ScoredThread | ScoredThread[]) => (Array.isArray(t) ? t : [t]);

  const archive = (t: ScoredThread | ScoredThread[]) => file(many(t), "done", "Archived");
  const trash = (t: ScoredThread | ScoredThread[]) => file(many(t), "trash", "Moved to Trash");
  const spam = (t: ScoredThread | ScoredThread[]) => file(many(t), "spam", "Reported as spam");
  const toInbox = (t: ScoredThread | ScoredThread[]) => {
    const list = many(t);
    const from = list[0]?.status;
    file(list, "inbox", from === "spam" ? "Marked as not spam" : from === "trash" ? "Restored to inbox" : "Moved to inbox");
  };
  const snooze = (t: ScoredThread | ScoredThread[], label: string, until: number) =>
    file(many(t), "snoozed", `Snoozed: ${label.toLowerCase()}`, until);
  const forward = (t: ScoredThread) => compose(forwardDraft(t));
  const purge = (t: ScoredThread) => {
    store.purgeThreads([t.id]);
    toast("Deleted forever", { description: t.subject });
  };

  /** Star or unstar: if any of them is unstarred, star them all. */
  const star = (t: ScoredThread | ScoredThread[]) => {
    const list = many(t);
    if (list.length === 0) return;
    const starred = list.some((x) => !x.starred);
    remember(list, starred ? "Starred" : "Unstarred");
    store.bulk(
      list.map((x) => x.id),
      { kind: "star", starred },
    );
    if (list.length > 1) toast(starred ? "Starred" : "Unstarred", { description: describe(list) });
  };

  /** Read or unread: if any of them is unread, mark them all read. Pass `unread` to force it. */
  const markRead = (t: ScoredThread | ScoredThread[], unread?: boolean) => {
    const list = many(t);
    if (list.length === 0) return;
    const next = unread ?? !list.some((x) => x.unread);
    remember(list, next ? "Marked as unread" : "Marked as read");
    store.bulk(
      list.map((x) => x.id),
      { kind: "read", unread: next },
    );
    if (list.length > 1) toast(next ? "Marked as unread" : "Marked as read", { description: describe(list) });
  };

  const move = (t: ScoredThread | ScoredThread[], spaceId: ScoredThread["space"]) => {
    const list = many(t).filter((x) => x.space !== spaceId);
    if (list.length === 0) return;
    const target = store.spaces.find((s) => s.id === spaceId);
    store.bulk(
      list.map((x) => x.id),
      { kind: "move", space: spaceId },
    );
    const domains = new Set(list.map((x) => x.messages[0].from.email.split("@")[1]));
    if (domains.size !== 1) {
      toast(`Moved to ${target?.name}`, { description: describe(list) });
      return;
    }
    const [domain] = domains;
    toast(`Moved to ${target?.name}`, {
      description: `Route everything from @${domain} there too?`,
      action: {
        label: "Always",
        onClick: () => {
          store.addRule({ field: "fromDomain", value: domain, space: spaceId });
          toast.success(`New rule: @${domain} → ${target?.name}`);
        },
      },
    });
  };

  /** Undo the last archive, delete, snooze, star or read change. */
  const undo = () => {
    if (!lastUndo) {
      toast("Nothing to undo");
      return;
    }
    const { label, run } = lastUndo;
    run();
    toast(`Undone: ${label.toLowerCase()}`);
  };

  return { archive, trash, spam, toInbox, snooze, forward, purge, move, star, markRead, undo };
}

/** Wraps a trigger element in a tooltip showing a label and an optional key. */
function Tip({ label, hint, render, children }: { label: string; hint?: string; render: ReactElement; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={render}>{children}</TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {hint && <kbd className="ml-1 rounded bg-background/20 px-1 font-mono text-[10px]">{hint}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}

function IconAction({
  label,
  hint,
  onClick,
  children,
  className,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tip
      label={label}
      hint={hint}
      render={<Button size="icon-sm" variant="ghost" onClick={onClick} aria-label={label} className={className} />}
    >
      {children}
    </Tip>
  );
}

/** The main way out of the current folder: archive from the inbox, back to the inbox from elsewhere. */
function primaryAction(thread: ScoredThread) {
  switch (thread.status) {
    case "inbox":
      return { label: "Archive", hint: "E", icon: Archive };
    case "trash":
      return { label: "Restore", hint: undefined, icon: Undo2 };
    case "spam":
      return { label: "Not spam", hint: undefined, icon: ShieldCheck };
    default:
      return { label: "Move to inbox", hint: undefined, icon: Inbox };
  }
}

export function PurgeDialog({
  thread,
  open,
  onOpenChange,
}: {
  thread: ScoredThread;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { purge } = useThreadCommands();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Delete this conversation forever?</DialogTitle>
          <DialogDescription>
            “{thread.subject || "(no subject)"}” is erased from the server. This can’t be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              purge(thread);
              onOpenChange(false);
            }}
          >
            Delete forever
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ThreadActions({
  thread,
  compact = false,
  className,
}: {
  thread: ScoredThread;
  compact?: boolean;
  className?: string;
}) {
  const store = useStore();
  const { archive, trash, spam, toInbox, snooze, forward, move, star, markRead } = useThreadCommands();
  const [purging, setPurging] = useState(false);
  const isInbox = thread.status === "inbox";
  const primary = primaryAction(thread);
  const Primary = primary.icon;

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <Tip
        label={primary.label}
        hint={primary.hint}
        render={
          <Button
            size={compact ? "icon-sm" : "sm"}
            variant={compact ? "ghost" : "outline"}
            onClick={() => (isInbox ? archive(thread) : toInbox(thread))}
            aria-label={primary.label}
            className={cn(!compact && "mr-1 px-2.5")}
          />
        }
      >
        <Primary />
        {!compact && primary.label}
      </Tip>

      {thread.status === "trash" ? (
        !compact && (
          <IconAction
            label="Delete forever"
            onClick={() => setPurging(true)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </IconAction>
        )
      ) : (
        <IconAction label="Delete" hint="#" onClick={() => trash(thread)}>
          <Trash2 />
        </IconAction>
      )}

      {!compact && thread.status !== "spam" && thread.status !== "trash" && (
        <IconAction label="Report spam" hint="!" onClick={() => spam(thread)}>
          <ShieldAlert />
        </IconAction>
      )}

      {isInbox && (
        <DropdownMenu>
          <Tip
            label="Snooze"
            hint="Z"
            render={<DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Snooze" />} />}
          >
            <Clock />
          </Tip>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
              {snoozeOptions(store.now).map((o) => (
                <DropdownMenuItem key={o.label} onClick={() => snooze(thread, o.label, o.until)}>
                  {o.label}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(o.until).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {!compact && (
        <>
          <IconAction
            label={thread.starred ? "Unstar" : "Star"}
            hint="S"
            onClick={() => star(thread)}
          >
            <Star className={cn(thread.starred && "fill-warning text-warning")} />
          </IconAction>
          <IconAction
            label={thread.unread ? "Mark as read" : "Mark as unread"}
            hint="U"
            onClick={() => markRead(thread)}
          >
            {thread.unread ? <MailOpen /> : <Mail />}
          </IconAction>
          <DropdownMenu>
            <Tip
              label="More"
              render={<DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="More actions" />} />}
            >
              <MoreHorizontal />
            </Tip>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => forward(thread)}>
                <Forward />
                Forward
                <DropdownMenuShortcut>F</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft />
                  Move to space
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {store.spaces.map((s) => (
                    <DropdownMenuItem key={s.id} disabled={s.id === thread.space} onClick={() => move(thread, s.id)}>
                      <SpaceDot space={s} />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              {thread.status !== "inbox" && thread.status !== "done" && (
                <DropdownMenuItem onClick={() => archive(thread)}>
                  <Archive />
                  Archive
                </DropdownMenuItem>
              )}
              {thread.status === "spam" ? (
                <DropdownMenuItem onClick={() => toInbox(thread)}>
                  <ShieldCheck />
                  Not spam
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => spam(thread)}>
                  <ShieldAlert />
                  Report spam
                  <DropdownMenuShortcut>!</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
              {thread.status === "trash" ? (
                <DropdownMenuItem variant="destructive" onClick={() => setPurging(true)}>
                  <Trash2 />
                  Delete forever…
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onClick={() => trash(thread)}>
                  <Trash2 />
                  Delete
                  <DropdownMenuShortcut>#</DropdownMenuShortcut>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <PurgeDialog thread={thread} open={purging} onOpenChange={setPurging} />
        </>
      )}
    </div>
  );
}
