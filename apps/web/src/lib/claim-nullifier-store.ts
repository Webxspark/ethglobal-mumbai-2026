import type { ClaimNullifierStore } from "@proofwork/shared";

const claimByAccount = new Map<string, string>();
const claimOwnerByNullifier = new Map<string, string>();

function norm(k: string): string {
  return k.trim().toLowerCase();
}

/** Process-local gig PoH bindings (hydrated from session on verify). */
export function webClaimNullifierStore(): ClaimNullifierStore {
  return {
    getByAccount(accountKey) {
      return claimByAccount.get(norm(accountKey)) ?? null;
    },
    getAccountForClaimNullifier(claimNullifier) {
      return claimOwnerByNullifier.get(norm(claimNullifier)) ?? null;
    },
    bind(i) {
      const accountKey = norm(i.accountKey);
      const claimNullifier = i.claimNullifier.trim();
      claimByAccount.set(accountKey, claimNullifier);
      claimOwnerByNullifier.set(norm(claimNullifier), accountKey);
      return {
        accountKey,
        claimNullifier,
        boundAt: Date.now(),
      };
    },
  };
}

export function hydrateClaimStoreFromSession(
  accountKey: string,
  claimNullifier: string | null | undefined,
): void {
  const account = norm(accountKey);
  const claim = claimNullifier?.trim();
  if (!account || !claim) return;
  claimByAccount.set(account, claim);
  claimOwnerByNullifier.set(norm(claim), account);
}
