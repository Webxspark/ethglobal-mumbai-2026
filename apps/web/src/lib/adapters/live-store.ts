"use client";

import type {
  Address,
  BudgetPot,
  EscrowTask,
  PotId,
  TaskId,
  ThreadMessage,
  UnixSecs,
  Wei,
} from "@proofwork/shared/browser";
import { WEI_PER_UNIT } from "../constants";
import { fetchSessionPot } from "../session-pot";
import {
  callMcpTool,
  fetchMcpAudit,
  McpHttpError,
  revivePot,
  reviveTask,
  type AuditEvent,
} from "./mcp-client";

type Listener = () => void;

export type SpendEntry = {
  id: string;
  label: string;
  amountWei: Wei;
  at: UnixSecs;
  kind: "fund" | "encumber" | "payout" | "refund";
};

export type ApprovalRequest = {
  id: string;
  taskId: TaskId;
  title: string;
  amountWei: Wei;
  reason: string;
  createdAt: UnixSecs;
  status: "pending" | "approved" | "rejected";
};

export type AppState = {
  pot: BudgetPot;
  tasks: Record<string, EscrowTask>;
  threads: Record<string, ThreadMessage[]>;
  spend: SpendEntry[];
  approvals: ApprovalRequest[];
  audit: { type: string; sequenceNumber: string; at: number }[];
  workerNullifier: string | null;
};

export type LiveLoadError = {
  kind: "unreachable" | "pot" | "mcp";
  message: string;
};

/** Placeholder until the signed-in session pot is loaded — never a demo pot. */
const emptyPot = (): BudgetPot => ({
  id: "" as PotId,
  owner: "0x0000000000000000000000000000000000000000" as Address,
  balanceWei: 0n as Wei,
  spentWei: 0n as Wei,
  agentPassThresholdWei: WEI_PER_UNIT as Wei,
});

let state: AppState = {
  pot: emptyPot(),
  tasks: {},
  threads: {},
  spend: [],
  approvals: [],
  audit: [],
  workerNullifier: null,
};
let ready = false;
let loadError: LiveLoadError | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

function classifyLiveError(err: unknown): LiveLoadError {
  if (err instanceof McpHttpError) {
    if (err.status === 404 || err.status === 400 || err.status === 401) {
      return { kind: "pot", message: err.message };
    }
    return {
      kind: "mcp",
      message: err.message || `MCP HTTP ${err.status}`,
    };
  }
  if (err instanceof Error) {
    const msg = err.message || "request failed";
    if (
      err.name === "TypeError" ||
      /failed to fetch|network|econnrefused|load failed/i.test(msg)
    ) {
      return { kind: "unreachable", message: msg };
    }
    return { kind: "pot", message: msg };
  }
  return { kind: "unreachable", message: "MCP unreachable" };
}

function spendFromAudit(events: AuditEvent[], tasks: Record<string, EscrowTask>): SpendEntry[] {
  const rows: SpendEntry[] = [];

  for (const e of events) {
    const tid = e.taskId;
    if (e.type === "Paid" && tid) {
      const t = tasks[tid];
      const when = e.at > 1e12 ? Math.floor(e.at / 1000) : e.at;
      rows.push({
        id: `mcp-${e.sequenceNumber}`,
        label: `Paid · ${tid.slice(0, 10)}`,
        amountWei: (t?.rewardWei ?? 0n) as Wei,
        at: when as SpendEntry["at"],
        kind: "payout",
      });
    }

    if (e.type === "TaskPosted" && tid) {
      const t = tasks[tid];
      const when = e.at > 1e12 ? Math.floor(e.at / 1000) : e.at;
      rows.push({
        id: `mcp-${e.sequenceNumber}`,
        label: `Encumbered · ${tid.slice(0, 10)}`,
        amountWei: (t?.rewardWei ?? 0n) as Wei,
        at: when as SpendEntry["at"],
        kind: "encumber",
      });
    }
  }

  return rows;
}

export function getLiveState(): AppState {
  return state;
}

export function getLiveLoadError(): LiveLoadError | null {
  return loadError;
}

export function subscribeLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isLiveReady(): boolean {
  return ready;
}

/** Pull the signed-in user's pot + their gigs + HCS audit from MCP. */
export async function refreshLiveStore(): Promise<AppState> {
  if (inflight) {
    await inflight;
    return state;
  }
  inflight = (async () => {
    try {
      const sessionPot = await fetchSessionPot();
      await callMcpTool("ensure_account", {
        nullifierHash: sessionPot.nullifierHash,
      });
      const [potRaw, listRaw, audit] = await Promise.all([
        callMcpTool<Record<string, unknown>>("pot_status", {
          potId: sessionPot.potId,
          nullifierHash: sessionPot.nullifierHash,
        }),
        callMcpTool<Record<string, unknown>[]>("list", {
          potId: sessionPot.potId,
        }),
        fetchMcpAudit(50),
      ]);

      const pot = revivePot(potRaw);
      const tasks: Record<string, EscrowTask> = {};
      for (const row of listRaw ?? []) {
        const t = reviveTask(row);
        if (t.potId && t.potId !== sessionPot.potId) continue;
        tasks[t.id] = t;
      }

      const auditUi = audit
        .slice()
        .reverse()
        .map((e) => ({
          type: e.type,
          sequenceNumber: e.sequenceNumber,
          at: e.at > 1e12 ? e.at : e.at * 1000,
        }));

      state = {
        pot,
        tasks,
        threads: state.threads,
        spend: spendFromAudit(audit.slice().reverse(), tasks),
        approvals: state.approvals,
        audit: auditUi.filter(
          (e) =>
            e.type !== "McpUnreachable" &&
            e.type !== "PotError" &&
            e.type !== "McpError",
        ),
        // Prefer World session nullifier as the worker id SoT.
        workerNullifier:
          sessionPot.nullifierHash?.trim() || state.workerNullifier,
      };
      loadError = null;
      ready = true;
      emit();
    } catch (err) {
      loadError = classifyLiveError(err);
      if (!ready) {
        state = {
          ...state,
          pot: emptyPot(),
          audit: [
            {
              type:
                loadError.kind === "unreachable"
                  ? "McpUnreachable"
                  : loadError.kind === "pot"
                    ? "PotError"
                    : "McpError",
              sequenceNumber: "ui-error",
              at: Date.now(),
            },
            ...state.audit.filter(
              (e) =>
                e.type !== "McpUnreachable" &&
                e.type !== "PotError" &&
                e.type !== "McpError",
            ),
          ],
        };
        emit();
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();
  await inflight;
  return state;
}

export function patchLive(mutator: (draft: AppState) => void): void {
  const next: AppState = {
    ...state,
    pot: { ...state.pot },
    tasks: { ...state.tasks },
    threads: { ...state.threads },
    spend: [...state.spend],
    approvals: state.approvals.map((a) => ({ ...a })),
    audit: [...state.audit],
  };
  mutator(next);
  state = next;
  emit();
}

export function seedLiveApproval(approval: ApprovalRequest): void {
  patchLive((s) => {
    if (s.approvals.some((a) => a.id === approval.id)) return;
    s.approvals = [approval, ...s.approvals];
  });
}

export function approveLivePending(id: string): void {
  patchLive((s) => {
    const hit = s.approvals.find((a) => a.id === id);
    if (!hit || hit.status !== "pending") return;
    hit.status = "approved";
  });
}
