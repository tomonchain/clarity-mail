import { cn } from "@/lib/utils";

/** The Clarity mark: three settling lines on a deep blue tile. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-[30%] bg-[linear-gradient(145deg,oklch(0.64_0.16_255),oklch(0.42_0.17_262))] shadow-[inset_0_1px_0_oklch(1_0_0/30%),0_1px_2px_oklch(0.3_0.12_260/35%),0_4px_10px_-4px_oklch(0.45_0.17_260/55%)]",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" className="size-[62%]" fill="none">
        <path d="M6 10.5h20M6 16h13M6 21.5h7.5" stroke="white" strokeWidth="3.2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Clarity <span className="font-normal text-muted-foreground">Mail</span>
      </span>
    </span>
  );
}
