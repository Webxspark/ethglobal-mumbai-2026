import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { MessagesDesk } from "@/components/messages/messages-desk";

export default function OwnerMessagesPage() {
  return (
    <AppShell title="Messages" flush>
      <Suspense fallback={<LoadingPanel label="Loading messages…" />}>
        <MessagesDesk role="owner" basePath="/owner/messages" />
      </Suspense>
    </AppShell>
  );
}
