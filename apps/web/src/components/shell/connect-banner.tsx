"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  getLiveLoadError,
  subscribeLive,
  type LiveLoadError,
} from "@/lib/adapters/live-store";
import { useAppState } from "@/lib/adapters/use-app-state";
function useLiveLoadError(): LiveLoadError | null {
  return useSyncExternalStore(
    subscribeLive,
    getLiveLoadError,
    () => null,
  );
}

export function ConnectBanner() {
  const state = useAppState();
  const loadError = useLiveLoadError();

  const banner = useMemo(() => {
    if (loadError) return loadError;
    for (const e of state.audit) {
      if (e.type === "McpUnreachable") {
        return {
          kind: "unreachable" as const,
          message: "MCP unreachable",
        };
      }
      if (e.type === "PotError") {
        return {
          kind: "pot" as const,
          message: "Could not load pot",
        };
      }
      if (e.type === "McpError") {
        return {
          kind: "mcp" as const,
          message: "MCP error",
        };
      }
    }
    return null;
  }, [loadError, state.audit]);

  if (!banner) return null;

  if (banner.kind === "unreachable") {
    return (
      <div className="pw-connect-banner" role="status">
        <p className="text-[13px] font-medium">MCP unreachable</p>
        <p className="text-[12px] text-muted-foreground">
          Run <span className="font-mono text-[11px]">npm start</span> (MCP
          :38472 + web :38471), then refresh.
        </p>
      </div>
    );
  }

  if (banner.kind === "pot") {
    return (
      <div className="pw-connect-banner" role="status">
        <p className="text-[13px] font-medium">Could not load pot</p>
        <p className="text-[12px] text-muted-foreground">
          {banner.message}. Sign out and back in, or refresh after MCP is up —
          your World account pot is created on login.
        </p>
      </div>
    );
  }

  return (
    <div className="pw-connect-banner" role="status">
      <p className="text-[13px] font-medium">MCP error</p>
      <p className="text-[12px] text-muted-foreground">{banner.message}</p>
    </div>
  );
}
