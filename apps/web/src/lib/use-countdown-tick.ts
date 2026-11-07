"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refreshLiveStore } from "@/lib/adapters/live-store";

/**
 * One-second clock for countdown labels. When any watched deadline is at or
 * past now, refresh MCP state (lazy sweep) — debounced to avoid spam.
 */
export function useCountdownTick(
  deadlines: Array<number | null | undefined>,
): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const lastRefreshAt = useRef(0);

  const maybeRefresh = useCallback(() => {
    const hit = deadlines.some((dl) => dl != null && dl <= now);
    if (!hit) return;
    const t = Date.now();
    if (t - lastRefreshAt.current < 2_500) return;
    lastRefreshAt.current = t;
    void refreshLiveStore().catch(() => undefined);
  }, [deadlines, now]);

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    maybeRefresh();
  }, [maybeRefresh]);

  return now;
}
