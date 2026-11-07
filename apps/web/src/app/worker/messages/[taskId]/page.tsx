import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { MessagesDesk } from "@/components/messages/messages-desk";

export default async function WorkerMessageThreadPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <AppShell title="Messages" flush>
      <Suspense fallback={<LoadingPanel label="Loading thread…" />}>
        <MessagesDesk
          role="worker"
          taskId={taskId}
          basePath="/worker/messages"
        />
      </Suspense>
    </AppShell>
  );
}
