import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { PotConsole } from "@/components/owner/pot-console";

export default function OwnerGigsPage() {
  return (
    <AppShell
      title="Gigs"
      subtitle="Review evidence. Approve over-threshold spend."
      breadcrumb={[{ label: "Owner", href: "/owner" }, { label: "Gigs" }]}
    >
      <Suspense fallback={<LoadingPanel label="Loading gigs…" />}>
        <PotConsole section="gigs" />
      </Suspense>
    </AppShell>
  );
}
