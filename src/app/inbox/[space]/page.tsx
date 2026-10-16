import { Suspense } from "react";
import { PRERENDERED_SPACE_IDS } from "@/lib/space-ids";
import { InboxRoute } from "./inbox-route";

export const instant = false;

export function generateStaticParams() {
  return PRERENDERED_SPACE_IDS.map((space) => ({ space }));
}

export default function InboxPage() {
  return (
    <Suspense>
      <InboxRoute />
    </Suspense>
  );
}
