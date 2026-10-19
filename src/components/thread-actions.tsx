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

export function useThreadCommands() {
  const store = useStore();
  const { compose } = useCompose();

  /** Change a thread's status and offer to undo it. */
  const file = (t: ScoredThread, status: ThreadStatus, message: string, until?: number) => {
    const snapshot = store.threads.find((x) => x.id === t.id);
    store.setStatus(t.id, status, until);
    toast(message, {
      description: t.subject,
      action: snapshot ? { label: "Undo", onClick: () => store.restoreThreads([snapshot]) } : undefined,
    });
  };

  const archive = (t: ScoredThread) => file(t, "done", "Archived");
  const trash = (t: ScoredThread) => file(t, "trash", "Moved to Trash");
  const spam = (t: ScoredThread) => file(t, "spam", "Reported as spam");
  const toInbox = (t: ScoredThread) =>
    file(t, "inbox", t.status === "spam" ? "Marked as not spam" : t.status === "trash" ? "Restored to inbox" : "Moved to inbox");
  const snooze = (t: ScoredThread, label: string, until: number) =>
    file(t, "snoozed", `Snoozed: ${label.toLowerCase()}`, until);
  const forward = (t: ScoredThread) => compose(forwardDraft(t));
  const purge = (t: ScoredThread) => {
    store.purgeThreads([t.id]);
    toast("Deleted forever", { description: t.subject });
  };

  const move = (t: ScoredThread, spaceId: ScoredThread["space"]) => {
    const target = store.spaces.find((s) => s.id === spaceId);
    const domain = t.messages[0].from.email.split("@")[1];
    store.moveToSpace(t.id, spaceId);
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

  return { archive, trash, spam, toInbox, snooze, forward, purge, move };
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
  const { archive, trash, spam, toInbox, snooze, forward, move } = useThreadCommands();
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
            onClick={() => store.toggleStar(thread.id)}
          >
            <Star className={cn(thread.starred && "fill-warning text-warning")} />
          </IconAction>
          <IconAction
            label={thread.unread ? "Mark as read" : "Mark as unread"}
            hint="U"
            onClick={() => store.setUnread(thread.id, !thread.unread)}
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
