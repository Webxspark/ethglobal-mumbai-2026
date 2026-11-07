import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { PotConsole } from "@/components/owner/pot-console";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function OwnerOverviewPage() {
  return (
    <AppShell
      title="Overview"
      subtitle="Balance, escrow, and recent pot activity."
      breadcrumb={[{ label: "Owner", href: "/owner" }, { label: "Overview" }]}
      actions={
        <Link href="/owner/pot" className={cn(buttonVariants({ size: "sm" }))}>
          Fund pot
        </Link>
      }
    >
      <Suspense fallback={<LoadingPanel label="Loading…" />}>
        <PotConsole section="overview" />
      </Suspense>
    </AppShell>
  );
}
