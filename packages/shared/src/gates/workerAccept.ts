import type { HumanPort } from "../ports/index.js";
import type { RequireHumanResult } from "../worldAuthTypes.js";
import { WorldAuthError } from "../worldAuthTypes.js";
import {
  assertOrBindClaimNullifier,
  type ClaimNullifierStore,
} from "./claimNullifier.js";
import { extractIdKitProofNullifier } from "../adapters/idkit/extractNullifier.js";
import {
  gateSessionReplayAck,
  isSessionReplayAckProof,
} from "./replayAck.js";

export type GateWorkerAcceptInput = {
  /** Full IDKit result payload (forward as-is) or stub proof. */
  proof: unknown;
  nullifierHash?: string;
  /** Bound into proof signal — typically worker address. */
  signal?: string;
  action?: string;
  /** Signed-in World account key (OIDC sub) — binds gig PoH nullifier. */
  accountKey?: string;
  claimStore?: ClaimNullifierStore;
  environment?: string;
  /** When set, used for session replay-ack (portal action already consumed). */
  boundClaimNullifier?: string;
};

/**
 * IDKit Proof of Human gate — must succeed before EscrowPort.accept.
 * Enforces nullifier ban list; cancel → cancelled; bad verify → verify_failed.
 */
export async function gateWorkerAccept(
  human: HumanPort,
  input: GateWorkerAcceptInput,
): Promise<RequireHumanResult> {
  if (isSessionReplayAckProof(input.proof)) {
    const account = input.accountKey?.trim();
    const bound =
      input.boundClaimNullifier?.trim() ||
      input.claimStore?.getByAccount(account ?? "") ||
      account;
    if (!account || !input.claimStore || !bound?.trim()) {
      throw new WorldAuthError(
        "verify_failed",
        "claim_poh_not_bound",
      );
    }
    return gateSessionReplayAck({
      accountKey: account,
      boundClaimNullifier: bound,
      claimStore: input.claimStore,
      environment: input.environment ?? "staging",
      action: input.action ?? "proofwork-accept",
    });
  }

  let result: RequireHumanResult;
  try {
    result = await human.requireHuman({
      proof: input.proof,
      nullifierHash:
        input.nullifierHash ??
        input.claimStore?.getByAccount(input.accountKey?.trim() ?? "") ??
        undefined,
      signal: input.signal,
      action: input.action,
    });
  } catch (err) {
    const bound = input.accountKey?.trim()
      ? input.claimStore?.getByAccount(input.accountKey.trim())
      : null;
    const proofNf = extractIdKitProofNullifier(input.proof);
    if (
      err instanceof WorldAuthError &&
      err.code === "verify_failed" &&
      bound &&
      proofNf &&
      proofNf.toLowerCase() === bound.toLowerCase() &&
      input.claimStore &&
      input.accountKey?.trim()
    ) {
      return gateSessionReplayAck({
        accountKey: input.accountKey.trim(),
        boundClaimNullifier: bound,
        claimStore: input.claimStore,
        environment: input.environment ?? "staging",
        action: input.action ?? "proofwork-accept",
      });
    }
    throw err;
  }

  if (await human.isBanned(result.nullifierHash)) {
    throw new WorldAuthError("banned_nullifier");
  }

  if (input.claimStore && input.accountKey?.trim()) {
    assertOrBindClaimNullifier(
      input.claimStore,
      input.accountKey,
      result.nullifierHash,
    );
  }

  return result;
}
