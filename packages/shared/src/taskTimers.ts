import type { EscrowTask } from "./types.js";

/** UI + MCP: warn when fewer than five minutes remain. */
export const COUNTDOWN_WARN_SECS = 300;

export function unixNowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

/** Seconds until a unix deadline; null when unset; past deadlines → 0. */
export function secsUntil(
  deadlineUnix: number | null | undefined,
  nowSecs = unixNowSecs(),
): number | null {
  if (deadlineUnix == null) return null;
  return Math.max(0, deadlineUnix - nowSecs);
}

export type TaskTimerSnapshot = {
  expires_remaining_secs: number | null;
  claim_remaining_secs: number | null;
  respond_remaining_secs: number | null;
  expiresRemainingSecs: number | null;
  claimRemainingSecs: number | null;
  respondRemainingSecs: number | null;
};

export function taskTimerFields(
  task: Pick<
    EscrowTask,
    "deadlineAt" | "expiresAt" | "claimExpiresAt" | "respondDeadline"
  >,
  nowSecs = unixNowSecs(),
): TaskTimerSnapshot {
  const deadline = task.deadlineAt ?? task.expiresAt ?? null;
  const expires = secsUntil(deadline, nowSecs);
  const claim = secsUntil(task.claimExpiresAt ?? null, nowSecs);
  const respond = secsUntil(task.respondDeadline ?? null, nowSecs);
  return {
    expires_remaining_secs: expires,
    claim_remaining_secs: claim,
    respond_remaining_secs: respond,
    expiresRemainingSecs: expires,
    claimRemainingSecs: claim,
    respondRemainingSecs: respond,
  };
}

/** Human label for max_work_secs, e.g. 1800 → "30m". */
export function formatWorkWindowLabel(
  maxWorkSecs: number | null | undefined,
): string | null {
  if (maxWorkSecs == null || maxWorkSecs <= 0) return null;
  if (maxWorkSecs >= 3600 && maxWorkSecs % 3600 === 0) {
    return `${maxWorkSecs / 3600}h`;
  }
  if (maxWorkSecs >= 60) {
    const m = Math.round(maxWorkSecs / 60);
    return `${m}m`;
  }
  return `${maxWorkSecs}s`;
}
