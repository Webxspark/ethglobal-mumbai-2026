import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { TaskFlow } from "@/components/worker/task-flow";

export default function WorkerTasksPage() {
  return (
    <AppShell
      title="Gig board"
      subtitle="Filter open gigs. Claim starts the work timer."
      breadcrumb={[
        { label: "Worker", href: "/worker/tasks" },
        { label: "Gig board" },
      ]}
    >
      <Suspense fallback={<LoadingPanel label="Loading tasks…" />}>
        <TaskFlow view="board" />
      </Suspense>
    </AppShell>
  );
}
