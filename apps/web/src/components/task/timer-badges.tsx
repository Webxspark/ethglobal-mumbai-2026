"use client";

import type { EscrowTask } from "@proofwork/shared/browser";
import { EscrowStatus } from "@proofwork/shared/browser";
import {
  countdownToneClass,
  displayCountdown,
  secsLeft,
} from "@/lib/countdown";
import { useCountdownTick } from "@/lib/use-countdown-tick";

/** Gig deadline, claim work window, and respond-SLA countdowns (1s tick). */
export function TimerBadges({ task }: { task: EscrowTask }) {
  const deadline = task.deadlineAt ?? task.expiresAt ?? null;
  const now = useCountdownTick([
    deadline,
    task.claimExpiresAt,
    task.respondDeadline,
  ]);

  const deadlineLeft = secsLeft(deadline, now);
  const claimLeft = secsLeft(task.claimExpiresAt ?? null, now);
  const slaLeft = secsLeft(task.respondDeadline ?? null, now);

  const showDeadline =
    deadline != null &&
    (task.status === EscrowStatus.Open ||
      task.status === EscrowStatus.Accepted ||
      task.status === EscrowStatus.Expired);

  const showClaim =
    task.claimExpiresAt != null && task.status === EscrowStatus.Accepted;

  const showSla =
    task.respondDeadline != null &&
    (task.status === EscrowStatus.Submitted ||
      task.status === EscrowStatus.ExpiredSla);

  if (!showDeadline && !showClaim && !showSla) return null;

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
      {showDeadline ? (
        <span className={countdownToneClass(deadlineLeft)}>
          Gig {displayCountdown(deadlineLeft, "gig")}
        </span>
      ) : null}
      {showClaim ? (
        <span className={countdownToneClass(claimLeft)}>
          Submit {displayCountdown(claimLeft, "work")}
        </span>
      ) : null}
      {showSla ? (
        <span className={countdownToneClass(slaLeft)}>
          Agent SLA {displayCountdown(slaLeft, "sla")}
        </span>
      ) : null}
    </div>
  );
}

/** Single-line primary timer for dense table cells. */
export function GigRowCountdown({ task }: { task: EscrowTask }) {
  const deadline = task.deadlineAt ?? task.expiresAt ?? null;
  const now = useCountdownTick([deadline, task.claimExpiresAt]);

  if (task.status === EscrowStatus.Accepted && task.claimExpiresAt != null) {
    const left = secsLeft(task.claimExpiresAt, now);
    return (
      <span
        className={`font-mono text-[11px] tabular-nums ${countdownToneClass(left) ?? "text-muted-foreground"}`}
      >
        {displayCountdown(left, "work")}
      </span>
    );
  }

  if (
    task.status === EscrowStatus.Submitted &&
    task.respondDeadline != null
  ) {
    const left = secsLeft(task.respondDeadline, now);
    return (
      <span
        className={`font-mono text-[11px] tabular-nums ${countdownToneClass(left) ?? "text-muted-foreground"}`}
      >
        {displayCountdown(left, "sla")}
      </span>
    );
  }

  if (deadline != null && task.status === EscrowStatus.Open) {
    const left = secsLeft(deadline, now);
    return (
      <span
        className={`font-mono text-[11px] tabular-nums ${countdownToneClass(left) ?? "text-muted-foreground"}`}
      >
        {displayCountdown(left, "gig")}
      </span>
    );
  }

  return <span className="font-mono text-[11px] text-muted-foreground">—</span>;
}
