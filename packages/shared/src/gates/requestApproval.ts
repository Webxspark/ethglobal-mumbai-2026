import type { HcsAuditPort, WorldPassPort } from "../ports/index.js";
import type {
  Address,
  PotId,
  TaskId,
  Wei,
} from "../types.js";
import type {
  BeginOwnerApprovalResult,
  WorldIdentity,
} from "../worldAuthTypes.js";
import { WorldAuthError } from "../worldAuthTypes.js";

export type GateRequestApprovalInput = {
  taskId: TaskId;
  potId: PotId;
  amountWei: Wei;
  owner: Address;
  reason: string;
  redirectUri: string;
  expectedOwner?: WorldIdentity;
  /** When set, skip begin if amount is strictly below threshold. */
  thresholdWei?: Wei;
  maxAgeSecs?: number;
  ttlSecs?: number;
};

export type GateRequestApprovalResult = BeginOwnerApprovalResult & {
  required: true;
  skipped?: false;
};

export type GateRequestApprovalSkipped = {
  required: false;
  skipped: true;
  reason: "below_threshold";
};

/**
 * Owner approval gate for over-threshold agent spend (Agent Pass Continuity).
 * Call from MCP `request_approval` or owner console before encumbering.
 */
export async function gateRequestApproval(
  world: WorldPassPort,
  input: GateRequestApprovalInput,
  audit?: HcsAuditPort,
): Promise<GateRequestApprovalResult | GateRequestApprovalSkipped> {
  if (
    input.thresholdWei !== undefined &&
    input.amountWei < input.thresholdWei
  ) {
    return { required: false, skipped: true, reason: "below_threshold" };
  }

  const started = await world.beginOwnerApproval({
    taskId: input.taskId,
    potId: input.potId,
    amountWei: input.amountWei,
    owner: input.owner,
    reason: input.reason,
    expectedOwner: input.expectedOwner,
    redirectUri: input.redirectUri,
    maxAgeSecs: input.maxAgeSecs,
    ttlSecs: input.ttlSecs,
  });

  if (audit) {
    await audit.append({
      type: "ApprovalRequested",
      potId: input.potId,
      taskId: input.taskId,
      amount: input.amountWei,
    });
  }

  return { ...started, required: true };
}

/**
 * Finish Continuity callback → protected action may proceed.
 * Emits ApprovalGranted only on success.
 */
export async function gateCompleteApproval(
  world: WorldPassPort,
  input: { approvalId: string; code: string; state: string },
  audit?: HcsAuditPort,
) {
  try {
    const result = await world.completeOwnerApproval(input);
    const record = await world.getApproval(result.approvalId);
    if (audit) {
      await audit.append({
        type: "ApprovalGranted",
        potId: record.potId,
        taskId: record.taskId,
      });
    }
    return result;
  } catch (err) {
    if (err instanceof WorldAuthError) {
      throw err;
    }
    throw new WorldAuthError("invalid_token", String(err));
  }
}
