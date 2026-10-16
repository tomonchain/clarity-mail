"use client";

import { ArrowRightLeft, Check, Clock, Inbox, MailOpen, Mail, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpaceDot } from "@/components/space-badge";
import { snoozeOptions } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { ScoredThread } from "@/lib/types";
import { cn } from "@/lib/utils";

export function useThreadCommands() {
  const store = useStore();

  const done = (t: ScoredThread) => {
    const snapshot = store.threads.find((x) => x.id === t.id);
    store.setStatus(t.id, "done");
    toast.success("Marked as done", {
      description: t.subject,
      action: snapshot
        ? { label: "Undo", onClick: () => store.restoreThreads([snapshot]) }
        : undefined,
    });
  };

  const snooze = (t: ScoredThread, label: string, until: number) => {
    const snapshot = store.threads.find((x) => x.id === t.id);
    store.setStatus(t.id, "snoozed", until);
    toast(`Snoozed: ${label.toLowerCase()}`, {
      description: t.subject,
      action: snapshot
        ? { label: "Undo", onClick: () => store.restoreThreads([snapshot]) }
        : undefined,
    });
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

  return { done, snooze, move };
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
  const { done, snooze, move } = useThreadCommands();
  const isInbox = thread.status === "inbox";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {isInbox ? (
        <Button
          size={compact ? "icon-sm" : "sm"}
          variant={compact ? "ghost" : "outline"}
          onClick={() => done(thread)}
          aria-label="Mark as done"
          title="Mark as done"
        >
          <Check />
          {!compact && "Done"}
        </Button>
      ) : (
        <Button
          size={compact ? "icon-sm" : "sm"}
          variant={compact ? "ghost" : "outline"}
          onClick={() => store.setStatus(thread.id, "inbox")}
          aria-label="Move back to inbox"
          title="Move back to inbox"
        >
          <Inbox />
          {!compact && "Back to inbox"}
        </Button>
      )}

      {isInbox && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size={compact ? "icon-sm" : "sm"}
                variant="ghost"
                aria-label="Snooze"
                title="Snooze"
              />
            }
          >
            <Clock />
            {!compact && "Snooze"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
              {snoozeOptions(store.now).map((o) => (
                <DropdownMenuItem key={o.label} onClick={() => snooze(thread, o.label, o.until)}>
                  {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {!compact && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => store.toggleStar(thread.id)}
            aria-label={thread.starred ? "Unstar" : "Star"}
            title={thread.starred ? "Unstar" : "Star"}
          >
            <Star className={cn(thread.starred && "fill-amber-400 text-amber-500")} />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => store.setUnread(thread.id, !thread.unread)}
            aria-label={thread.unread ? "Mark as read" : "Mark as unread"}
            title={thread.unread ? "Mark as read" : "Mark as unread"}
          >
            {thread.unread ? <MailOpen /> : <Mail />}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Move to space" title="Move to space" />
              }
            >
              <ArrowRightLeft />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Move to space</DropdownMenuLabel>
                {store.spaces.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    disabled={s.id === thread.space}
                    onClick={() => move(thread, s.id)}
                  >
                    <SpaceDot space={s} />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
