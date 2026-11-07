import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { MessagesDesk } from "@/components/messages/messages-desk";

export default async function OwnerMessageThreadPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <AppShell title="Messages" flush>
      <Suspense fallback={<LoadingPanel label="Loading thread…" />}>
        <MessagesDesk
          role="owner"
          taskId={taskId}
          basePath="/owner/messages"
        />
      </Suspense>
    </AppShell>
  );
}
