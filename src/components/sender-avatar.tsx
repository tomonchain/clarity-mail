"use client";

import { useState } from "react";
import { useDisplayPrefs } from "@/lib/display";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

function hue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

// What each address turned out to have, so a row that remounts shows it at once.
const looks = new Map<string, "photo" | "logo" | "none">();

/** The sender's picture over the initials, once it has loaded; nothing when there is none. */
function SenderPhoto({ email }: { email: string }) {
  const [look, setLook] = useState(() => looks.get(email));
  if (look === "none") return null;
  const settle = (next: "photo" | "logo" | "none") => {
    looks.set(email, next);
    setLook(next);
  };
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served by our own avatar route
    <img
      src={`/api/avatar/${encodeURIComponent(email)}`}
      alt=""
      loading="lazy"
      decoding="async"
      // A company icon is small and drawn on white: it sits inside the circle instead of filling it.
      onLoad={(event) => settle(event.currentTarget.naturalWidth >= 96 ? "photo" : "logo")}
      onError={() => settle("none")}
      className={cn(
        "absolute inset-0 size-full rounded-full bg-white transition-opacity",
        look === undefined && "opacity-0",
        look === "logo" ? "object-contain p-[18%] ring-1 ring-black/5 ring-inset" : "object-cover",
      )}
    />
  );
}

/** Initials on a soft tint derived from the address, so a sender is recognisable at a glance. */
export function SenderAvatar({
  name,
  email,
  size = "md",
  className,
}: {
  name: string;
  email: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const h = hue((email || name).toLowerCase());
  const label = initials(name || email) || (email[0] ?? "?").toUpperCase();
  const { senderPhotos } = useDisplayPrefs();
  const address = email.trim().toLowerCase();
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
      {senderPhotos && address.includes("@") && <SenderPhoto key={address} email={address} />}
    </span>
  );
}
