import type { TeePort } from "../../ports/index.js";
import type { SignedTeeVerdict, TaskId } from "../../types.js";
import { signVerdict } from "../../crypto/verdict.js";
import type { Hex } from "viem";

export type LiveTeeConfig = {
  /** 0G TeeML / Compute HTTP endpoint. */
  endpoint: string;
  apiKey?: string;
  /**
   * Local fallback signer used when the TeeML response includes the verdict
   * JSON but not a secp256k1 signature (demo / staging). Prefer TEE-attested
   * signatures from the network when present.
   */
  fallbackPrivateKey?: Hex;
};

type TeeMlResponse = {
  approved?: boolean;
  resultHash?: `0x${string}`;
  signature?: `0x${string}`;
  signer?: `0x${string}`;
  requestId?: string;
  verdict?: { approved?: boolean; resultHash?: string };
};

/**
 * Live 0G TeeML client. Posts the submission payload, then ensures an
 * Escrow-compatible EIP-191 signature exists (network-provided or fallback).
 */
export function createLiveTee(cfg: LiveTeeConfig): TeePort {
  if (!cfg.endpoint) {
    throw new Error("PROOFWORK_TEE_MODE=live requires OG_TEEML_URL");
  }

  return {
    async scoreSubmission({ taskId, payload }): Promise<SignedTeeVerdict> {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          taskId,
          payload,
          schema: "proofwork.verdict.v1",
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`TeeML HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as TeeMlResponse;
      const approved = Boolean(
        data.approved ?? data.verdict?.approved ?? false,
      );
      const resultHash = (data.resultHash ??
        data.verdict?.resultHash ??
        `0x${"00".repeat(32)}`) as `0x${string}`;

      if (data.signature && data.signer) {
        return {
          taskId: taskId as TaskId,
          resultHash,
          approved,
          signer: data.signer as SignedTeeVerdict["signer"],
          signature: data.signature,
          requestId: data.requestId,
        };
      }

      if (!cfg.fallbackPrivateKey) {
        throw new Error(
          "TeeML response missing signature; set OG_TEEML_FALLBACK_PK for demo signing",
        );
      }

      const signed = await signVerdict({
        taskId,
        resultHash,
        approved,
        privateKey: cfg.fallbackPrivateKey,
      });
      return {
        taskId: taskId as TaskId,
        resultHash,
        approved,
        signer: signed.signer,
        signature: signed.signature,
        requestId: data.requestId ?? `live-0g-${Date.now()}`,
      };
    },
  };
}
