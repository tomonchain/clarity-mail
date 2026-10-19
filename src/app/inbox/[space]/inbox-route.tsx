"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { InboxView } from "@/components/inbox-view";
import { ALL_TABS, type InboxTab } from "@/lib/folders";

function InboxWithTab({ spaceId }: { spaceId: string }) {
  const params = useSearchParams();
  const tab = params.get("tab");
  const accountId = params.get("account") ?? undefined;
  const initialTab = ALL_TABS.includes(tab as InboxTab) ? (tab as InboxTab) : undefined;
  return (
    <InboxView
      key={`${spaceId}-${initialTab}-${accountId}`}
      spaceId={spaceId}
      initialTab={initialTab}
      accountId={accountId}
    />
  );
}

export function InboxRoute() {
  const { space } = useParams<{ space: string }>();
  return (
    <Suspense fallback={<InboxView spaceId={space} />}>
      <InboxWithTab spaceId={space} />
    </Suspense>
  );
}
