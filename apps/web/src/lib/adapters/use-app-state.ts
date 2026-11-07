"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isLivePollingPaused } from "./live-poll";
import {
  getLiveState,
  refreshLiveStore,
  subscribeLive,
  type AppState,
} from "./live-store";

/**
 * App state for owner/worker boards — mirrored snapshot of MCP compose (not Arkiv feed).
 * (refreshed on mount + after mutations).
 * Interval skips while pauseLivePolling() is held (claim / PoH modal open).
 */
export function useAppState(): AppState {
  const state = useSyncExternalStore(subscribeLive, getLiveState, getLiveState);

  useEffect(() => {
    let cancelled = false;
    void refreshLiveStore().catch(() => {
      /* banner via audit McpUnreachable */
    });
    const id = window.setInterval(() => {
      if (cancelled || isLivePollingPaused()) return;
      void refreshLiveStore().catch(() => undefined);
    }, 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return state;
}
