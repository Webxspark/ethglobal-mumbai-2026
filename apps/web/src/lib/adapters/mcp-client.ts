"use client";

import type {
  Address,
  BudgetPot,
  EscrowTask,
  TaskId,
  UnixSecs,
  Wei,
} from "@proofwork/shared";
export class McpHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(
      message ??
        (typeof body === "object" &&
        body &&
        "error" in body &&
        typeof (body as { error: unknown }).error === "string"
          ? (body as { error: string }).error
          : `MCP HTTP ${status}`),
    );
    this.name = "McpHttpError";
    this.status = status;
    this.body = body;
  }
}

function reviveWei(v: unknown): Wei {
  if (typeof v === "bigint") return v as Wei;
  if (typeof v === "number") return BigInt(v) as Wei;
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v) as Wei;
  throw new Error(`invalid wei: ${String(v)}`);
}

function reviveUnix(v: unknown): UnixSecs | null {
  if (v == null) return null;
  return Number(v) as UnixSecs;
}

export function reviveTask(raw: Record<string, unknown>): EscrowTask {
  const deadlineAt = reviveUnix(raw.deadlineAt ?? raw.expiresAt);
  return {
    ...(raw as unknown as EscrowTask),
    id: raw.id as TaskId,
    rewardWei: reviveWei(raw.rewardWei),
    createdAt: Number(raw.createdAt) as UnixSecs,
    verifyDeadline: reviveUnix(raw.verifyDeadline),
    deadlineAt,
    expiresAt: deadlineAt,
    maxWorkSecs: raw.maxWorkSecs == null ? null : Number(raw.maxWorkSecs),
    claimExpiresAt: reviveUnix(raw.claimExpiresAt),
    claimedAt: reviveUnix(raw.claimedAt),
    blockedWorkers: Array.isArray(raw.blockedWorkers)
      ? (raw.blockedWorkers as Address[])
      : [],
    respondDeadline: reviveUnix(raw.respondDeadline),
    respondSlaSecs:
      raw.respondSlaSecs == null ? null : Number(raw.respondSlaSecs),
    notifyUrl:
      typeof raw.notifyUrl === "string" ? raw.notifyUrl : (raw.notifyUrl as null),
    lockTxHash:
      typeof raw.lockTxHash === "string"
        ? (raw.lockTxHash as `0x${string}`)
        : null,
    lockExplorerUrl:
      typeof raw.lockExplorerUrl === "string" ? raw.lockExplorerUrl : null,
    payoutTxHash:
      typeof raw.payoutTxHash === "string"
        ? (raw.payoutTxHash as `0x${string}`)
        : null,
    payoutAddress:
      typeof raw.payoutAddress === "string"
        ? (raw.payoutAddress as EscrowTask["payoutAddress"])
        : null,
    payoutExplorerUrl:
      typeof raw.payoutExplorerUrl === "string" ? raw.payoutExplorerUrl : null,
    category: typeof raw.category === "string" ? raw.category : null,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    title: typeof raw.title === "string" ? raw.title : null,
    posterAgent: typeof raw.posterAgent === "string" ? raw.posterAgent : null,
    submissionForm:
      raw.submissionForm && typeof raw.submissionForm === "object"
        ? (raw.submissionForm as EscrowTask["submissionForm"])
        : null,
    formResponse:
      raw.formResponse && typeof raw.formResponse === "object"
        ? (raw.formResponse as EscrowTask["formResponse"])
        : null,
  };
}

export function revivePot(raw: Record<string, unknown>): BudgetPot {
  return {
    id: String(raw.id ?? raw.potId ?? "") as BudgetPot["id"],
    owner: String(raw.owner ?? "") as BudgetPot["owner"],
    balanceWei: reviveWei(raw.balanceWei),
    spentWei: reviveWei(raw.spentWei),
    agentPassThresholdWei: reviveWei(raw.agentPassThresholdWei),
  };
}

/**
 * MCP HTTP base. Prefer same-origin Next rewrite (`/api/mcp`) to avoid CORS;
 * fall back to direct localhost for scripts.
 */
export function mcpBaseUrl(): string {
  if (typeof window !== "undefined") {
    return (
      process.env.NEXT_PUBLIC_PROOFWORK_MCP_URL?.replace(/\/$/, "") ?? "/api/mcp"
    );
  }
  return (
    process.env.PROOFWORK_MCP_URL ??
    process.env.MCP_URL ??
    process.env.NEXT_PUBLIC_PROOFWORK_MCP_URL ??
    "http://127.0.0.1:38472"
  ).replace(/\/$/, "");
}

export type AuditEvent = {
  type: string;
  sequenceNumber: string;
  at: number;
  taskId?: string;
};

async function parseJson(res: Response): Promise<unknown> {
  const txt = await res.text();
  if (!txt) return {};
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    // MCP sometimes returns plain text on proxy blips
    return { error: txt };
  }
}

/** Call MCP `POST /tools/<name>` (or proxied `/api/mcp/tools/<name>`). */
export async function callMcpTool<T = unknown>(
  name: string,
  body: unknown = {},
  opts: { paid?: boolean } = {},
): Promise<T> {
  const base = mcpBaseUrl().replace(/\/$/, "");
  void opts.paid; // paid tools need connect bearer / x402 — never inject a fake payment
  const res = await fetch(`${base}/tools/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body, (_, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  });
  const json = await parseJson(res);
  if (!res.ok) {
    throw new McpHttpError(res.status, json);
  }
  const envelope = json as { result?: T };
  return (envelope.result ?? json) as T;
}

export async function fetchMcpHealth(): Promise<Record<string, unknown>> {
  const base = mcpBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/health`);
  const json = await parseJson(res);
  if (!res.ok) throw new McpHttpError(res.status, json);
  return json as Record<string, unknown>;
}

export async function fetchMcpAudit(limit = 40): Promise<AuditEvent[]> {
  const base = mcpBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/audit?limit=${limit}`);
  const json = await parseJson(res);
  if (!res.ok) throw new McpHttpError(res.status, json);
  const events =
    (json as { events?: { sequenceNumber: string; event: Record<string, unknown>; at?: number }[] })
      .events ?? [];
  return events.map((row) => ({
    type: String(row.event?.type ?? "Unknown"),
    sequenceNumber: row.sequenceNumber,
    at: row.at ?? Date.now(),
    taskId:
      typeof row.event?.taskId === "string" ? row.event.taskId : undefined,
  }));
}
