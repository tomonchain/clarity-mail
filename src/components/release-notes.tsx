"use client";

import { Fragment, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { APP_VERSION, shippedReleases, type Release } from "@/lib/releases";
import { takePreviousVersion, useUpdates } from "@/lib/updates";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTION_EVENT = "clarity:settings-section";

/** `code` and **bold** in a one-line note. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
          <code key={i} className="rounded bg-secondary px-1 py-px font-mono text-[0.85em]">
            {part.slice(1, -1)}
          </code>
        ) : part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ReleaseNotes({ release }: { release: Release }) {
  const current = release.version === APP_VERSION;
  return (
    <article className="space-y-4 px-5 py-5">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">{release.version}</h3>
        {current && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
            This version
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {release.date ? formatDate(release.date) : "Not released yet"}
        </span>
      </header>
      {release.intro && <p className="text-sm text-muted-foreground">{release.intro}</p>}
      {release.sections.map((section) => (
        <section key={section.title} className="space-y-1.5">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.title}</h4>
          <ul className="list-disc space-y-1 pl-4 text-sm leading-relaxed marker:text-muted-foreground/50">
            {section.items.map((item) => (
              <li key={item}>
                <Inline text={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}

export function ReleaseHistory({ className }: { className?: string }) {
  return (
    <div className={cn("divide-y", className)}>
      {shippedReleases().map((release) => (
        <ReleaseNotes key={release.version} release={release} />
      ))}
    </div>
  );
}

/** Settings → Updates, also when Settings is already open (a hash change alone doesn't switch the tab). */
function useGoToUpdates() {
  const router = useRouter();
  return () => {
    if (window.location.pathname === "/settings")
      window.dispatchEvent(new CustomEvent(SETTINGS_SECTION_EVENT, { detail: "updates" }));
    else router.push("/settings#updates");
  };
}
/** In the sidebar when a newer version is out. */
export function UpdatePill({ onNavigate }: { onNavigate?: () => void }) {
  const { available, info } = useUpdates();
  const goToUpdates = useGoToUpdates();
  if (!available || !info?.latest) return null;
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        goToUpdates();
      }}
      className="flex w-full items-center gap-2 rounded-lg bg-brand-soft px-2.5 py-2 text-left text-xs font-medium text-brand transition-colors hover:bg-brand/15"
    >
      <ArrowUpCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Version {info.latest.version} is out</span>
    </button>
  );
}

/** Once after an update: says so, with a way to what changed. */
export function UpdatedNotice() {
  const goToUpdates = useGoToUpdates();
  useEffect(() => {
    const previous = takePreviousVersion();
    if (!previous || previous === APP_VERSION) return;
    toast(`Clarity Mail is now ${APP_VERSION}`, {
      description: `Updated from ${previous}.`,
      duration: 10_000,
      action: { label: "What's new", onClick: goToUpdates },
    });
    // Once per load: the notice must not come back when the router changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
