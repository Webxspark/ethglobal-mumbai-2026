"use client";

import type {
  ArkivPort,
  EscrowPort,
  HcsAuditPort,
  HumanPort,
  PotPort,
  ThreadPort,
  WorldPassPort,
} from "@proofwork/shared";
import {
  type TaskId,
  type ThreadMessage,
  type Wei,
} from "@proofwork/shared";
import { fetchSessionPot } from "../session-pot";
import { callMcpTool, revivePot, reviveTask } from "./mcp-client";
import { patchLive, refreshLiveStore } from "./live-store";

const bannedNullifiers = new Set<string>();

async function afterMutation<T>(result: T): Promise<T> {
  try {
    await refreshLiveStore();
  } catch {
    // UI keeps optimistic patch if refresh fails mid-flow.
  }
  return result;
}

export const mcpPot: PotPort = {
  async deposit() {
    throw new Error(
      "mcp pot.deposit blocked — use Fund pot → Pay with wallet (on-chain)",
    );
  },
  async withdraw() {
    throw new Error("Withdraw via MCP not exposed in web — owner-only on-chain");
  },
  async refundEncumbered() {
    throw new Error("Pot refunds are handled by MCP escrow sweeps / cancel tools");
  },
  async finalizePaidOut() {
    throw new Error("Payout finalization runs in MCP all_satisfied");
  },
  async status(potId) {
    const id =
      potId?.trim() ||
      (await fetchSessionPot().then((s) => s.potId).catch(() => ""));
    if (!id) {
      throw new Error("potId required — sign in; no demo pot fallback");
    }
    const raw = await callMcpTool<Record<string, unknown>>("pot_status", {
      potId: id,
    });
    return revivePot(raw);
  },
};

export const mcpEscrow: EscrowPort = {
  async createTask(input) {
    const raw = await callMcpTool<{ taskId: string; status: string }>(
      "post",
      {
        potId: input.potId,
        rewardWei: input.rewardWei.toString(),
        metadata: input.metadataCid,
        agentPassProof: input.agentPassProof ?? undefined,
        geo: input.geo ?? undefined,
        deadlineAt: input.deadlineAt ?? undefined,
        expiresAt: input.expiresAt ?? undefined,
        ttlSecs: input.ttlSecs ?? undefined,
        maxWorkSecs: input.maxWorkSecs ?? undefined,
        respondSlaSecs: input.respondSlaSecs ?? undefined,
        notifyUrl: input.notifyUrl ?? undefined,
        category: input.category ?? undefined,
        tags: input.tags ?? undefined,
        title: input.title ?? undefined,
        posterAgent: input.posterAgent ?? undefined,
      },
      { paid: true },
    );
    const task = await callMcpTool<Record<string, unknown>>("get", {
      taskId: raw.taskId,
    });
    return afterMutation(reviveTask(task));
  },

  async accept({ taskId, worker, humanNullifier, proof, signal, action }) {
    if (!humanNullifier?.trim() && typeof window === "undefined") {
      throw new Error("humanNullifier required — worker id is session-derived");
    }
    // Browser: session cookie supplies nullifier; never send DEMO_WORKER.
    if (typeof window !== "undefined") {
      if (proof == null) {
        throw new Error("proof required — complete IDKit verification first");
      }
      const res = await fetch("/api/worker/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, proof, signal, action }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "accept failed");
    } else {
      await callMcpTool("accept", {
        taskId,
        humanNullifier,
        ...(worker ? { worker } : {}),
        ...(proof != null ? { proof } : {}),
        ...(signal ? { signal } : {}),
        ...(action ? { action } : {}),
      });
    }
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async submit({ taskId, resultCid, formResponse }) {
    await callMcpTool("submit", {
      taskId,
      ...(resultCid ? { resultCid } : {}),
      ...(formResponse ? { form_response: formResponse } : {}),
      note: formResponse
        ? "Form submitted from worker UI"
        : "Evidence from worker UI",
    });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async verify() {
    throw new Error(
      "Tee path removed — use all_satisfied for release (ML inputs are advisory only).",
    );
  },

  async allSatisfied({ taskId, owner, note }) {
    await callMcpTool("all_satisfied", {
      taskId,
      owner,
      note,
    });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async dispute({ taskId, owner, reason }) {
    await callMcpTool("dispute", { taskId, owner, reason });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async requestChanges({ taskId, owner, note }) {
    await callMcpTool("request_changes", {
      taskId,
      owner,
      message: note,
    });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async resolveDispute({ taskId, owner, outcome, resultCid, note }) {
    await callMcpTool("resolve_dispute", {
      taskId,
      owner,
      outcome,
      resultCid: resultCid ?? undefined,
      note,
    });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async cancel({ taskId }) {
    await callMcpTool("cancel", { taskId }, { paid: true });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async expireRefund() {
    throw new Error("expireRefund not exposed on MCP demo tools");
  },

  async extendClaim({ taskId, owner, extraSecs }) {
    await callMcpTool("extend_claim", {
      taskId,
      owner,
      extra_secs: extraSecs,
    });
    const task = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return afterMutation(reviveTask(task));
  },

  async get(taskId) {
    const raw = await callMcpTool<Record<string, unknown>>("get", { taskId });
    return reviveTask(raw);
  },

  async list(q) {
    const raw = await callMcpTool<Record<string, unknown>[]>("list", {
      potId: q.potId,
      status: q.status,
      near: q.near,
      reward_min_wei: q.rewardMinWei?.toString(),
      reward_max_wei: q.rewardMaxWei?.toString(),
      category: q.category,
      tags: q.tags,
      deadline_before: q.deadlineBefore,
      poster_agent: q.posterAgent,
      search: q.search,
      sort: q.sort,
    });
    return (raw ?? []).map((row) => reviveTask(row));
  },
};

export const mcpWorldPass: WorldPassPort = {
  async assertAgentPass(_i) {
    void _i;
    throw new Error(
      "Use Continuity Agent Pass — POST /api/world/approve/start from the owner UI.",
    );
  },

  async beginOwnerApproval(_i) {
    void _i;
    throw new Error(
      "Continuity begins server-side — use POST /api/world/approve/start from the owner UI.",
    );
  },

  async completeOwnerApproval(_i) {
    void _i;
    throw new Error("Owner approval completes at GET /api/world/approve/callback");
  },

  async denyOwnerApproval(_i) {
    void _i;
    throw new Error("OAuth errors are handled in /api/world/approve/callback");
  },

  async getApproval(_approvalId) {
    void _approvalId;
    throw new Error("Read approval state via owner flows, not client stubs");
  },
};

export const mcpHuman: HumanPort = {
  async requireHuman(i) {
    if (
      !i.proof ||
      (typeof i.proof === "string" && i.proof.includes("staging-idkit"))
    ) {
      throw new Error(
        "Pass IDKit proof — open World IDKit and verify on this origin",
      );
    }
    const res = await fetch("/api/idkit/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idkitResponse: i.proof,
        nullifierHash: i.nullifierHash,
        signal: i.signal,
        action: i.action,
      }),
    });
    const body = (await res.json()) as {
      success?: boolean;
      nullifierHash?: string;
      environment?: string;
      action?: string;
      error?: string;
      message?: string;
    };
    if (!res.ok || !body.success || !body.nullifierHash) {
      throw new Error(body.message ?? body.error ?? "IDKit verify failed");
    }
    patchLive((s) => {
      s.workerNullifier = body.nullifierHash!;
    });
    return {
      nullifierHash: body.nullifierHash,
      verified: true,
      environment: (body.environment as "staging" | "production") ?? "staging",
      action: body.action ?? "proofwork-accept",
    };
  },
  async isBanned(n) {
    return bannedNullifiers.has(n);
  },
  async ban(n, _reason) {
    void _reason;
    bannedNullifiers.add(n);
  },
};

export const mcpThread: ThreadPort = {
  async post(i) {
    return callMcpTool<ThreadMessage>("thread_post", {
      taskId: i.taskId,
      role: i.role,
      body: i.body,
      attachmentCid: i.attachmentCid ?? undefined,
      kind: i.kind,
    });
  },
  async list(taskId) {
    const rows = await callMcpTool<ThreadMessage[]>("thread_list", { taskId });
    return rows ?? [];
  },
};

export const mcpHcs: HcsAuditPort = {
  async append(event) {
    patchLive((s) => {
      s.audit.unshift({
        type: event.type,
        sequenceNumber: `ui-${event.type}-${Date.now()}`,
        at: Date.now(),
      });
    });
    return { sequenceNumber: `ui-${event.type}` };
  },
};

/** Read-only Arkiv view — writes happen in MCP projector only. */
export const mcpArkiv: ArkivPort = {
  async upsertTaskEntity() {
    throw new Error(
      "Arkiv writes are server-side only (MCP projector after escrow events)",
    );
  },
  async nearby({ lat, lng, radiusM }) {
    const rows = await callMcpTool<Record<string, unknown>[]>("list", {
      near: { lat, lng, radiusM },
    });
    return (rows ?? []).map((r) => r.id as TaskId);
  },
};

/** Set Agent Pass threshold on the signed-in user's pot (not part of PotPort). */
export async function mcpSetThreshold(wei: Wei): Promise<void> {
  const sessionPot = await fetchSessionPot();
  await callMcpTool("pot_set_threshold", {
    potId: sessionPot.potId,
    thresholdWei: wei.toString(),
  });
  await refreshLiveStore();
}

export const mcpPorts = {
  pot: mcpPot,
  escrow: mcpEscrow,
  thread: mcpThread,
  worldPass: mcpWorldPass,
  human: mcpHuman,
  hcs: mcpHcs,
  arkiv: mcpArkiv,
} as const;
