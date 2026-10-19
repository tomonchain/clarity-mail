import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

function hue(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
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
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold tracking-tight select-none",
        "bg-[oklch(0.93_0.045_var(--h))] text-[oklch(0.42_0.11_var(--h))] dark:bg-[oklch(0.34_0.06_var(--h))] dark:text-[oklch(0.9_0.06_var(--h))]",
        size === "sm" && "size-6 text-[10px]",
        size === "md" && "size-9 text-[13px]",
        size === "lg" && "size-10 text-sm",
        className,
      )}
      style={{ "--h": h } as React.CSSProperties}
    >
      {label}
    </span>
  );
}
