import { NextResponse } from "next/server";
import {
  WorldAuthError,
  gateRequestApproval,
  type Address,
  type PotId,
  type TaskId,
  type Wei,
} from "@proofwork/shared";
import { getWorldAuth } from "@/lib/worldAuth";

/**
 * Start Agent Pass Continuity approval for over-threshold spend.
 * Body: { taskId, potId, amountWei, owner, reason, expectedOwner?, thresholdWei? }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      taskId: string;
      potId: string;
      amountWei: string;
      owner: string;
      reason: string;
      redirectUri?: string;
      expectedOwner?: { iss: string; sub: string };
      thresholdWei?: string;
    };

    if (!body.taskId || !body.potId || !body.amountWei || !body.owner) {
      return NextResponse.json(
        { error: "missing_fields" },
        { status: 400 },
      );
    }

    const auth = getWorldAuth();
    const result = await gateRequestApproval(auth.world, {
      taskId: body.taskId as TaskId,
      potId: body.potId as PotId,
      amountWei: BigInt(body.amountWei) as Wei,
      owner: body.owner as Address,
      reason: body.reason ?? "over-threshold spend",
      redirectUri:
        body.redirectUri ?? auth.config.agentPass.redirectUri,
      expectedOwner: body.expectedOwner,
      thresholdWei:
        body.thresholdWei !== undefined
          ? (BigInt(body.thresholdWei) as Wei)
          : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof WorldAuthError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "start_failed", message: String(err) },
      { status: 500 },
    );
  }
}
