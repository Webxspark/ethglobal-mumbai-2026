import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { MessagesDesk } from "@/components/messages/messages-desk";

/** Owner gig detail — same messages desk with release actions. */
export default async function OwnerGigDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <AppShell title="Gig" flush>
      <Suspense fallback={<LoadingPanel label="Loading gig…" />}>
        <MessagesDesk role="owner" taskId={taskId} basePath="/owner/gigs" />
      </Suspense>
    </AppShell>
  );
}
