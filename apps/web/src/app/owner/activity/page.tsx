import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { PotConsole } from "@/components/owner/pot-console";

export default function OwnerActivityPage() {
  return (
    <AppShell
      title="Activity"
      subtitle="Spend ledger and HCS audit."
      breadcrumb={[{ label: "Owner", href: "/owner" }, { label: "Activity" }]}
    >
      <Suspense fallback={<LoadingPanel label="Loading activity…" />}>
        <PotConsole section="activity" />
      </Suspense>
    </AppShell>
  );
}
