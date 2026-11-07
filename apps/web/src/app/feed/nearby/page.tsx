import { Suspense } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { LoadingPanel } from "@/components/shell/loading-panel";
import { NearbyFeed } from "@/components/feed/nearby-feed";

export default function NearbyFeedPage() {
  return (
    <AppShell
      title="Nearby"
      subtitle="Arkiv geo entities. Same feed as MCP list(near)."
      breadcrumb={[
        { label: "Worker", href: "/worker/tasks" },
        { label: "Nearby" },
      ]}
    >
      <Suspense fallback={<LoadingPanel label="Loading nearby…" />}>
        <NearbyFeed />
      </Suspense>
    </AppShell>
  );
}
