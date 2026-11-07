import { createHash, randomBytes } from "node:crypto";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";

export type RpSignature = {
  sig: string;
  nonce: string;
  created_at: number;
  expires_at: number;
};

export type SignIdKitRpRequestInput = {
  cfg: WorldAuthConfig;
  /**
   * Uniqueness / enrollment action. Pass `null` to omit action entirely
   * (required for session-only RP signatures per IDKit v4 docs).
   * Omit / undefined → default WORLD_IDKIT_ACCEPT_ACTION.
   */
  action?: string | null;
  ttl?: number;
};

/**
 * Mint a fresh RP-signed IDKit request.
 * Always generates a new cryptographically random nonce + timestamps —
 * never cache, memoize, or reuse across attempts.
 */
export async function signIdKitRpRequest(
  i: SignIdKitRpRequestInput,
): Promise<RpSignature> {
  const ttl = i.ttl ?? 300;
  const omitAction = i.action === null;
  const action = omitAction ? undefined : (i.action ?? i.cfg.idkit.action);

  if (i.cfg.idkit.rpSigningKey?.trim()) {
    try {
      const mod = await import("@worldcoin/idkit-core/signing");
      const signed = mod.signRequest({
        signingKeyHex: i.cfg.idkit.rpSigningKey,
        ...(action !== undefined ? { action } : {}),
        ttl,
      });
      return {
        sig: signed.sig,
        nonce: signed.nonce,
        created_at: signed.createdAt,
        expires_at: signed.expiresAt,
      };
    } catch {
      // fall through to local stub if package missing
    }
  }

  // Stub path still mints a fresh nonce every call (no module-level constant).
  const created_at = Math.floor(Date.now() / 1000);
  const expires_at = created_at + ttl;
  const nonce = `0x${randomBytes(32).toString("hex")}`;
  const material = `${i.cfg.idkit.rpId}:${action ?? ""}:${nonce}:${created_at}:${expires_at}:${i.cfg.idkit.rpSigningKey || "stub"}`;
  const sig = `0xstub${createHash("sha256").update(material).digest("hex")}`;
  return { sig, nonce, created_at, expires_at };
}
