import type { ClientSession } from "./use-session";
import type { ProofworkSession } from "./session";

export type SessionPotRef = {
  potId: string;
  owner: string;
  nullifierHash: string;
};

/**
 * Live UI/API must bind to the signed-in World account pot only.
 */
export function requireSessionPot(
  session:
    | Pick<ClientSession, "authenticated" | "potId" | "owner" | "nullifierHash">
    | ProofworkSession
    | null
    | undefined,
): SessionPotRef {
  const authenticated =
    session && "authenticated" in session
      ? session.authenticated === true
      : Boolean(session?.potId && session?.owner && session?.nullifierHash);

  if (
    !session ||
    !authenticated ||
    !session.potId?.trim() ||
    !session.owner?.trim() ||
    !session.nullifierHash?.trim()
  ) {
    throw new Error("Sign in with World ID to use your pot");
  }

  return {
    potId: session.potId.trim(),
    owner: session.owner.trim(),
    nullifierHash: session.nullifierHash.trim(),
  };
}

/** Client helper — /api/auth/me → session pot (no demo fallback). */
export async function fetchSessionPot(
  fetchImpl: typeof fetch = fetch,
): Promise<SessionPotRef> {
  const res = await fetchImpl("/api/auth/me", { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Sign in with World ID to use your pot");
  }
  const json = (await res.json()) as ClientSession;
  return requireSessionPot(json);
}

/**
 * Fund credit target is always the session pot.
 * Client-supplied potId/owner are ignored.
 */
export function resolveFundCreditTarget(
  session: ProofworkSession | null,
): SessionPotRef {
  return requireSessionPot(session);
}
