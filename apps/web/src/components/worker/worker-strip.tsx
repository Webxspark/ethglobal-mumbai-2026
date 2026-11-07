"use client";

import { useAppState } from "@/lib/adapters/use-app-state";
import { formatHbar, shortAddr } from "@/lib/format";
import { AGENT_TOOLS } from "@/lib/agent-tools";

/** Top strip — pot summary + agent setup status (Lane A owns World session). */
export function WorkerStrip({ userId }: { userId?: string | null }) {
  const state = useAppState();
  const pot = state.pot;
  const openCount = Object.values(state.tasks).filter(
    (t) => t.status === "OPEN",
  ).length;
  const connectOk = state.audit.some(
    (a) => a.type === "ConnectBound" || a.type === "TaskPosted",
  );
  const agentHint = connectOk
    ? "Agent connected · posting live"
    : "Waiting on agent connect / post";

  return (
    <section className="pw-banner space-y-2" data-testid="worker-strip">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pw-kicker">Worker desk</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {userId ? shortAddr(userId) : "session pending (Lane A)"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Pot
          </p>
          <p className="pw-amount text-[15px]">{formatHbar(pot.balanceWei)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {openCount} open · threshold {formatHbar(pot.agentPassThresholdWei)}
        </span>
        <span aria-hidden>·</span>
        <span data-testid="agent-setup-status">{agentHint}</span>
        <span aria-hidden>·</span>
        <span className="font-mono text-[10px]">
          {AGENT_TOOLS.length} tools
        </span>
      </div>
    </section>
  );
}
