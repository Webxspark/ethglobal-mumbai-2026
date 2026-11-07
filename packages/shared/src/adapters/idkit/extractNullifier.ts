import type { IdKitVerifyPayload } from "../../worldAuthTypes.js";

/** Read PoH nullifier from an IDKit v4 payload without calling World verify. */
export function extractIdKitProofNullifier(proof: unknown): string | null {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const payload = proof as IdKitVerifyPayload;
  const first = payload.responses?.[0];
  return first?.nullifier ?? first?.nullifier_hash ?? null;
}
