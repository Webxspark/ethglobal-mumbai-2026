import { callMcpToolServer } from "@/lib/fund/mcp-server";
import {
  hydrateClaimStoreFromSession,
  webClaimNullifierStore,
} from "@/lib/claim-nullifier-store";
import type { ProofworkSession } from "@/lib/session";

export async function resolveBoundClaimNullifier(
  session: ProofworkSession,
): Promise<string | null> {
  hydrateClaimStoreFromSession(
    session.nullifierHash,
    session.claimNullifier,
  );
  const store = webClaimNullifierStore();
  const local = store.getByAccount(session.nullifierHash);
  if (local) return local;
  if (session.claimNullifier?.trim()) return session.claimNullifier.trim();
  try {
    const hit = await callMcpToolServer<{ claimNullifier?: string | null }>(
      "worker_claim_nullifier",
      { accountKey: session.nullifierHash },
    );
    const claim = hit.claimNullifier?.trim();
    if (claim) {
      store.bind({ accountKey: session.nullifierHash, claimNullifier: claim });
      return claim;
    }
  } catch {
    /* MCP optional in some dev setups */
  }
  // World App already proved this action — anchor replay to the signed-in OIDC sub.
  return session.nullifierHash.trim();
}
