import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { TaskFlow } from "@/components/worker/task-flow";

export default function WorkerClaimsPage() {
  return (
    <AppShell
      title="My claims"
      subtitle="Accepted gigs. Submit evidence before the timer ends."
      breadcrumb={[
        { label: "Worker", href: "/worker/tasks" },
        { label: "My claims" },
      ]}
    >
      <Suspense fallback={<LoadingPanel label="Loading claims…" />}>
        <TaskFlow view="claims" />
      </Suspense>
    </AppShell>
  );
}
