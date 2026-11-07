import { EscrowStatus, type EscrowTask, type UnixSecs } from "../types.js";

/**
 * REFUND-RACE INVARIANT
 * - Owner may cancel/refund only while OPEN|ACCEPTED, or after verifyDeadline if still SUBMITTED.
 * - Worker submit only from ACCEPTED → SUBMITTED + deadline.
 * - Submit and refund are mutually exclusive on the same status slot.
 */
export type RefundRaceReason = "already_submitted" | "verified" | "terminal";

export class RefundRaceError extends Error {
  readonly status = 409 as const;
  readonly reason: RefundRaceReason;

  constructor(reason: RefundRaceReason, message: string) {
    super(message);
    this.name = "RefundRaceError";
    this.reason = reason;
  }
}

export function canOwnerCancelOrRefund(
  task: Pick<EscrowTask, "status" | "verifyDeadline">,
  now: UnixSecs,
): boolean {
  if (
    task.status === EscrowStatus.Open ||
    task.status === EscrowStatus.Accepted
  ) {
    return true;
  }
  if (
    task.status === EscrowStatus.Submitted &&
    task.verifyDeadline !== null &&
    now > task.verifyDeadline
  ) {
    return true;
  }
  return false;
}

export function canWorkerSubmit(
  task: Pick<EscrowTask, "status">,
): boolean {
  return task.status === EscrowStatus.Accepted;
}

export function assertRefundRace(
  task: Pick<EscrowTask, "status" | "verifyDeadline">,
  now: UnixSecs,
  action: "cancel" | "submit",
): void {
  if (action === "submit") {
    if (!canWorkerSubmit(task)) {
      throw new RefundRaceError(
        "terminal",
        `refund-race: submit blocked from status ${task.status}`,
      );
    }
    return;
  }
  if (canOwnerCancelOrRefund(task, now)) {
    return;
  }
  if (task.status === EscrowStatus.Submitted) {
    throw new RefundRaceError(
      "already_submitted",
      "refund-race: cancel/refund blocked while SUBMITTED before verifyDeadline",
    );
  }
  if (
    task.status === EscrowStatus.Verified ||
    task.status === EscrowStatus.Paid
  ) {
    throw new RefundRaceError(
      "verified",
      `refund-race: cancel/refund blocked while ${task.status}`,
    );
  }
  throw new RefundRaceError(
    "terminal",
    `refund-race: cancel/refund blocked while ${task.status}`,
  );
}
