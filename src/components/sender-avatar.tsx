"use client";

import { useState } from "react";
import { useDisplayPrefs } from "@/lib/display";
import { initials } from "@/lib/format";
import { usePersonal } from "@/lib/personal";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function hue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Addresses that are a service rather than a person.
const AUTOMATED = /^(no-?reply|do-?not-?reply|ne-?pas-?repondre|notifications?|alerts?|mailer-daemon|newsletters?|news|info|hello|bonjour|contact|support|team|billing|receipts?|invoices?|updates?|marketing)([+._-]|@)/i;

/** Newsletters and notifications: their sender is a service, shown with its icon. */
export function automatedThread(thread: { category: string }) {
  return thread.category === "newsletter" || thread.category === "notification";
}

type Kind = "photo" | "logo";
// What each address turned out to have, so a row that remounts shows it at once.
const found = new Map<string, boolean>();

/** A picture from the avatar route over the initials once it has loaded; nothing when there is none. */
function Picture({ email, kind, className }: { email: string; kind: Kind; className: string }) {
  const key = `${kind}:${email}`;
  const [state, setState] = useState(() => found.get(key));
  if (state === false) return null;
  const settle = (ok: boolean) => {
    found.set(key, ok);
    setState(ok);
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own avatar route
    <img
      src={`/api/avatar/${encodeURIComponent(email)}?kind=${kind}`}
      alt=""
      loading="lazy"
      decoding="async"
      onLoad={() => settle(true)}
      onError={() => settle(false)}
      className={cn("transition-opacity", state === undefined && "opacity-0", className)}
    />
  );
}

/**
 * The sender's face when there is one (your own photo for your addresses, else their Gravatar),
 * else their initials on a tint derived from the address. A person writing from a company gets
 * its icon as a small badge; automated mail (newsletters, notifications) gets it full size.
 */
export function SenderAvatar({
  name,
  email,
  size = "md",
  automated = false,
  className,
}: {
  name: string;
  email: string;
  size?: "sm" | "md" | "lg";
  /** The thread is a newsletter or a notification. */
  automated?: boolean;
  className?: string;
}) {
  const h = hue((email || name).toLowerCase());
  const label = initials(name || email) || (email[0] ?? "?").toUpperCase();
  const { senderPhotos } = useDisplayPrefs();
  const { photo: ownPhoto } = usePersonal();
  const { accounts } = useStore();
  const address = email.trim().toLowerCase();
  const mine = accounts.some((a) => a.email.toLowerCase() === address || a.aliases.includes(address));
  const service = automated || AUTOMATED.test(address);
  const lookup = senderPhotos && address.includes("@") && !mine;

  return (
    <span
      aria-hidden
      className={cn(
        "relative grid shrink-0 place-items-center rounded-full font-semibold tracking-tight select-none",
        "bg-[oklch(0.93_0.045_var(--h))] text-[oklch(0.42_0.11_var(--h))] dark:bg-[oklch(0.34_0.06_var(--h))] dark:text-[oklch(0.9_0.06_var(--h))]",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-9 text-[13px]",
        size === "lg" && "size-10 text-sm",
        className,
      )}
      style={{ "--h": h } as React.CSSProperties}
    >
      {label}
      {mine && ownPhoto && (
        // eslint-disable-next-line @next/next/no-img-element -- a data: URL kept on this device
        <img src={ownPhoto} alt="" className="absolute inset-0 size-full rounded-full object-cover" />
      )}
      {lookup && service && (
        <Picture
          key={`logo:${address}`}
          email={address}
          kind="logo"
          className="absolute inset-0 size-full rounded-full bg-white object-contain p-[18%] ring-1 ring-black/5 ring-inset"
        />
      )}
      {lookup && !service && size !== "sm" && (
        <Picture
          key={`logo:${address}`}
          email={address}
          kind="logo"
          className="absolute -right-1 -bottom-1 size-[45%] rounded-full bg-white object-contain p-[10%] ring-2 ring-background"
        />
      )}
      {lookup && (
        <Picture
          key={`photo:${address}`}
          email={address}
          kind="photo"
          className="absolute inset-0 size-full rounded-full bg-white object-cover"
        />
      )}
    </span>
  );
}
