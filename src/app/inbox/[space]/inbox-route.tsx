"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { InboxView, type InboxTab } from "@/components/inbox-view";

const TABS: InboxTab[] = ["priority", "recent", "reply", "noise", "snoozed", "done"];

function InboxWithTab({ spaceId }: { spaceId: string }) {
  const tab = useSearchParams().get("tab");
  const initialTab = TABS.includes(tab as InboxTab) ? (tab as InboxTab) : undefined;
  return <InboxView key={`${spaceId}-${initialTab}`} spaceId={spaceId} initialTab={initialTab} />;
}

export function InboxRoute() {
  const { space } = useParams<{ space: string }>();
  return (
    <Suspense fallback={<InboxView spaceId={space} />}>
      <InboxWithTab spaceId={space} />
    </Suspense>
  );
}
