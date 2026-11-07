import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { MessagesDesk } from "@/components/messages/messages-desk";

/** Claim detail = full messages desk focused on one gig. */
export default async function WorkerClaimDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <AppShell title="Claim" flush>
      <Suspense fallback={<LoadingPanel label="Loading claim…" />}>
        <MessagesDesk
          role="worker"
          taskId={taskId}
          basePath="/worker/claims"
        />
      </Suspense>
    </AppShell>
  );
}
