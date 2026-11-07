import {
  EscrowStatus,
  type EscrowTask,
  type ThreadMessage,
  type UnixSecs,
} from "../types.js";

export const DISPUTE_REPLY_WAIT_SECS = 60;

const POSTING_ROLES = new Set(["agent", "owner"]);

function latestSubmissionAt(task: EscrowTask, thread: ThreadMessage[]): UnixSecs {
  if (task.submittedAt != null) return task.submittedAt;
  const workerEvidence = thread
    .filter(
      (m) =>
        m.role === "worker" &&
        (m.kind === "evidence" || m.kind === "form_response"),
    )
    .map((m) => m.createdAt);
  if (!workerEvidence.length) return 0 as UnixSecs;
  return Math.max(...workerEvidence) as UnixSecs;
}

/**
 * Server-side dispute gate: message the worker about the problem first;
 * dispute only after ~60s silence (or claim expired / abandonment).
 */
export function evaluateDisputeEligibility(input: {
  task: EscrowTask;
  thread: ThreadMessage[];
  now: UnixSecs;
  waitSecs?: number;
}): { ok: true } | { ok: false; message: string } {
  const { task, thread, now } = input;
  const wait = input.waitSecs ?? DISPUTE_REPLY_WAIT_SECS;

  if (
    task.status === EscrowStatus.Accepted &&
    task.claimExpiresAt != null &&
    now >= task.claimExpiresAt
  ) {
    return { ok: true };
  }

  if (task.status === EscrowStatus.Submitted) {
    const submittedAt = latestSubmissionAt(task, thread);
    const after = thread.filter((m) => m.createdAt >= submittedAt);
    const lastPosting = [...after]
      .reverse()
      .find(
        (m) =>
          POSTING_ROLES.has(m.role) &&
          m.kind !== "system" &&
          m.body.trim().length > 0,
      );

    if (!lastPosting) {
      return {
        ok: false,
        message:
          "dispute blocked: message the worker about the problem first (send_message or request_changes). Wrong evidence → request_changes, not dispute.",
      };
    }

    const workerReplied = after.some(
      (m) => m.role === "worker" && m.createdAt > lastPosting.createdAt,
    );
    if (workerReplied) {
      return {
        ok: false,
        message:
          "dispute blocked: worker replied after your message — review new evidence, request_changes, or all_satisfied.",
      };
    }

    const elapsed = now - lastPosting.createdAt;
    if (elapsed >= wait) {
      return { ok: true };
    }

    return {
      ok: false,
      message: `dispute blocked: wait ${wait - elapsed}s after your message for the worker to respond (or use request_changes for fixable evidence).`,
    };
  }

  if (task.status === EscrowStatus.Accepted) {
    return {
      ok: false,
      message:
        "dispute blocked: no submission yet — message the worker or wait for claim expiry.",
    };
  }

  return {
    ok: false,
    message: `dispute blocked from ${task.status}`,
  };
}
