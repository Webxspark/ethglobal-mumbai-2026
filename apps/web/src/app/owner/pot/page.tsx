import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { PotConsole } from "@/components/owner/pot-console";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export default function OwnerPotPage() {
  return (
    <AppShell
      title="Pot & Funding"
      subtitle="Deposit HBAR. Set Agent Pass threshold."
      breadcrumb={[
        { label: "Owner", href: "/owner" },
        { label: "Pot & Funding" },
      ]}
      actions={
        <Link
          href="/owner/agents"
          className={cn(buttonVariants({ size: "sm", variant: "secondary" }))}
        >
          Connect agent
        </Link>
      }
    >
      <Suspense fallback={<LoadingPanel label="Loading pot…" />}>
        <PotConsole section="pot" />
      </Suspense>
    </AppShell>
  );
}
