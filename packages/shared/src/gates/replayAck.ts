import type { RequireHumanResult } from "../worldAuthTypes.js";
import { WorldAuthError } from "../worldAuthTypes.js";
import {
  assertOrBindClaimNullifier,
  type ClaimNullifierStore,
} from "./claimNullifier.js";

export type SessionReplayAckProof = {
  readonly replayAck: true;
};

export function isSessionReplayAckProof(
  proof: unknown,
): proof is SessionReplayAckProof {
  return (
    !!proof &&
    typeof proof === "object" &&
    (proof as SessionReplayAckProof).replayAck === true
  );
}

/** Portal already burned the action — reuse bound gig PoH for this signed-in account. */
export function gateSessionReplayAck(i: {
  accountKey: string;
  boundClaimNullifier: string;
  claimStore: ClaimNullifierStore;
  environment: string;
  action: string;
}): RequireHumanResult {
  const bound = i.boundClaimNullifier.trim();
  if (!bound) throw new WorldAuthError("missing_nullifier");
  assertOrBindClaimNullifier(i.claimStore, i.accountKey, bound);
  return {
    nullifierHash: bound,
    verified: true,
    environment: i.environment,
    action: i.action,
  };
}
