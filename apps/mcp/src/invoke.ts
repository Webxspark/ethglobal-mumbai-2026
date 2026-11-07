import { ConnectAuthError, RefundRaceError } from "@proofwork/shared";
import type { ComposedPorts } from "@proofwork/shared/compose";
import { REQUEST_HEADER } from "@proofwork/shared/compose";
import { extractConnectToken } from "@proofwork/shared";
import { withConnectBinding, type ToolSession } from "./session.js";
import {
  BadRequest,
  NotFound,
  TOOL_TABLE,
  type PaidToolName,
  type ToolName,
  type Tools,
} from "./tools.js";

export class PaymentRequired extends Error {
  readonly status = 402 as const;
  readonly challenge: string;
  constructor(challenge: string) {
    super("payment required");
    this.name = "PaymentRequired";
    this.challenge = challenge;
  }
}

export type InvokeResult = {
  result: unknown;
  paymentResponse?: { name: string; value: string };
};

const POT_FUNDED_TOOLS = new Set<ToolName>(["post", "post_gig"]);

/**
 * Read tools that can proceed without a connect session when the caller
 * already passed potId / nullifier (stale Authorization must not 401 them).
 */
const SOFT_CONNECT_TOOLS = new Set<ToolName>([
  "pot_status",
  "get_account",
  "get_guide",
  "get",
  "list",
  "list_task_events",
  "list_my_gigs_updates",
  "thread_list",
  "list_messages",
]);

/**
 * Same gate as HTTP POST /tools/<name>:
 * - post/post_gig with a bearer/connect session → pot debit (no x402)
 * - other paid tools / anonymous pay-per-call → x402.decide → settle-after-success
 *
 * Optional connect headers bind potId for the duration of the call
 * (HTTP agent ↔ same MCP the web Review inbox uses).
 */
export async function invokeTool(deps: {
  tools: Tools;
  ports: ComposedPorts;
  name: ToolName;
  body: unknown;
  paymentHeader?: string;
  headers?: Record<string, string | undefined>;
  session?: ToolSession;
}): Promise<InvokeResult> {
  const row = TOOL_TABLE.find((t) => t.name === deps.name);
  if (!row) throw new BadRequest(`unknown tool ${deps.name}`);

  let requestBinding: import("@proofwork/shared").ConnectSession | null | undefined;
  if (deps.headers) {
    const raw = extractConnectToken(deps.headers);
    if (raw) {
      try {
        requestBinding = deps.ports.connect.resolve(raw);
      } catch (err) {
        if (err instanceof ConnectAuthError) {
          // Stale bearer on a read that already has potId/nullifier — drop it.
          if (SOFT_CONNECT_TOOLS.has(deps.name)) {
            requestBinding = null;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } else {
      // Isolate HTTP callers from any stdio/memory session residue.
      requestBinding = null;
    }
  }

  return withConnectBinding(requestBinding, async () => {
    const session = deps.session ?? deps.tools.session;
    const connected = session.get();

    // Bearer-authorized agents fund gigs from the human's pot — no x402.
    if (POT_FUNDED_TOOLS.has(deps.name) && connected) {
      const result = await deps.tools.dispatch(deps.name, deps.body, {
        actor: connected.owner,
        receipt: `pot-funded:${connected.potId}`,
      });
      return { result };
    }

    if (!row.paid) {
      const result = await deps.tools.dispatch(
        deps.name,
        deps.body,
        undefined,
      );
      return { result };
    }

    const paidTool = deps.name as PaidToolName;
    const headers: Record<string, string | undefined> = {
      ...(deps.headers ?? {}),
      [REQUEST_HEADER]: deps.paymentHeader,
      "X-PAYMENT": deps.paymentHeader,
    };

    const decision = await deps.ports.x402.decide({
      tool: paidTool,
      headers,
    });

    if (decision.kind === "challenge") {
      throw new PaymentRequired(decision.json);
    }

    try {
      const result = await deps.tools.dispatch(deps.name, deps.body, {
        actor: decision.actor.address,
        receipt: decision.actor.receipt,
      });
      await deps.ports.x402.settle({
        tool: paidTool,
        receipt: decision.actor.receipt,
        actor: decision.actor.address,
      });
      return {
        result,
        paymentResponse: {
          name: decision.responseHeader.name,
          value: decision.responseHeader.value,
        },
      };
    } catch (err) {
      // Settle-after-success: do not settle on tool failure.
      if (
        err instanceof RefundRaceError ||
        err instanceof BadRequest ||
        err instanceof NotFound
      ) {
        throw err;
      }
      throw err;
    }
  });
}

/** JSON-safe stringify (bigint → string). */
export function jsonText(value: unknown): string {
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}
