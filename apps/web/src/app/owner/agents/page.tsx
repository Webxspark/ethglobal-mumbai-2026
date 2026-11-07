import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { PotConsole } from "@/components/owner/pot-console";

export default function OwnerAgentsPage() {
  return (
    <AppShell
      title="Agents"
      subtitle="Issue a connect token. Copy MCP snippets."
      breadcrumb={[{ label: "Owner", href: "/owner" }, { label: "Agents" }]}
    >
      <Suspense fallback={<LoadingPanel label="Loading agents…" />}>
        <PotConsole section="agents" />
      </Suspense>
    </AppShell>
  );
}
