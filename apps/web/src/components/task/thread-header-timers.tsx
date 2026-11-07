"use client";

import type { EscrowTask } from "@proofwork/shared/browser";
import { TimerBadges } from "@/components/task/timer-badges";

/** Compact timer strip for message / claim thread headers. */
export function ThreadHeaderTimers({ task }: { task: EscrowTask }) {
  return (
    <div className="mt-1.5 border-t border-[#e6e8eb] pt-1.5">
      <TimerBadges task={task} />
    </div>
  );
}
