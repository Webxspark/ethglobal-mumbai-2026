"use client";

import { useEffect, useState } from "react";
import type { EscrowTask, TaskId } from "@proofwork/shared/browser";
import { callMcpTool, reviveTask } from "./mcp-client";

const TASK_POLL_MS = 2_500;

/**
 * Keep one gig row fresh while a thread is open (status, payout, timers).
 * Merges with the live-store snapshot when the poll has not run yet.
 */
export function useLiveTask(
  taskId: TaskId | null,
  fromStore: EscrowTask | null | undefined,
): EscrowTask | null {
  const [polled, setPolled] = useState<EscrowTask | null>(null);

  useEffect(() => {
    if (!taskId) {
      setPolled(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const raw = await callMcpTool<Record<string, unknown>>("get", {
          taskId,
        });
        if (!cancelled) setPolled(reviveTask(raw));
      } catch {
        /* keep last good row */
      }
    };
    void load();
    const id = window.setInterval(() => void load(), TASK_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [taskId]);

  if (polled) return polled;
  return fromStore ?? null;
}
