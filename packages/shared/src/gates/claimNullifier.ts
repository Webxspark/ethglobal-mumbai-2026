import { WorldAuthError } from "../worldAuthTypes.js";

/** Gig-claim PoH nullifier bound to a signed-in World account (OIDC sub). */
export type ClaimNullifierBinding = {
  readonly accountKey: string;
  readonly claimNullifier: string;
  readonly boundAt: number;
};

export interface ClaimNullifierStore {
  getByAccount(accountKey: string): string | null;
  /** Which account owns this PoH nullifier for gig claim, if any. */
  getAccountForClaimNullifier(claimNullifier: string): string | null;
  bind(i: { accountKey: string; claimNullifier: string }): ClaimNullifierBinding;
}

export type AssertClaimNullifierResult = {
  claimNullifier: string;
  /** True when this account had no prior binding. */
  firstBind: boolean;
};

/**
 * After IDKit verify succeeds, ensure the PoH nullifier belongs to this
 * signed-in account — or record it on first gig claim verify.
 */
export function assertOrBindClaimNullifier(
  store: ClaimNullifierStore,
  accountKey: string,
  verifiedClaimNullifier: string,
): AssertClaimNullifierResult {
  const account = accountKey.trim();
  const claim = verifiedClaimNullifier.trim();
  if (!account) {
    throw new WorldAuthError("invalid_proof", "account key required");
  }
  if (!claim) {
    throw new WorldAuthError("missing_nullifier");
  }

  const boundForAccount = store.getByAccount(account);
  if (boundForAccount) {
    if (boundForAccount !== claim) {
      throw new WorldAuthError(
        "verify_failed",
        "claim_nullifier_mismatch",
      );
    }
    return { claimNullifier: claim, firstBind: false };
  }

  const otherAccount = store.getAccountForClaimNullifier(claim);
  if (otherAccount && otherAccount !== account) {
    throw new WorldAuthError(
      "verify_failed",
      "claim_nullifier_other_account",
    );
  }

  store.bind({ accountKey: account, claimNullifier: claim });
  return { claimNullifier: claim, firstBind: true };
}
