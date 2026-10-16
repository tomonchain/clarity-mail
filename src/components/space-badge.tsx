import { cn } from "@/lib/utils";
import type { Space } from "@/lib/types";

export function SpaceDot({ space, className }: { space?: Space; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: space?.color ?? "var(--muted-foreground)" }}
    />
  );
}

export function SpaceBadge({ space, className }: { space?: Space; className?: string }) {
  if (!space) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <SpaceDot space={space} />
      {space.name}
    </span>
  );
}
