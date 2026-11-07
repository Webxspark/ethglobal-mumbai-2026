import type { HumanPort } from "../../ports/index.js";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import {
  WorldAuthError,
  type IdKitVerifyPayload,
  type RequireHumanResult,
} from "../../worldAuthTypes.js";
import { extractIdKitProofNullifier } from "./extractNullifier.js";
import { serializeIdKitVerifyBody } from "./forwardVerify.js";

const banned = new Set<string>();

export function createLiveHuman(
  cfg: WorldAuthConfig,
  fetchImpl: typeof fetch = fetch,
): HumanPort {
  if (!cfg.idkit.rpId && !cfg.idkit.appId) {
    throw new Error("WORLD_IDKIT_RP_ID or WORLD_IDKIT_APP_ID required for live mode");
  }

  return {
    async requireHuman(i): Promise<RequireHumanResult> {
      if (
        i.proof &&
        typeof i.proof === "object" &&
        (i.proof as { cancelled?: boolean }).cancelled === true
      ) {
        throw new WorldAuthError("cancelled");
      }

      if (!i.proof || typeof i.proof !== "object") {
        throw new WorldAuthError("invalid_proof", "expected IDKit payload object");
      }

      const payload = i.proof as IdKitVerifyPayload;
      const expectedEnvironment = cfg.idkit.environment;

      if (payload.environment && payload.environment !== expectedEnvironment) {
        throw new WorldAuthError("environment_mismatch");
      }

      const rpKey = cfg.idkit.rpId || cfg.idkit.appId;
      const verifyUrl = `${cfg.idkit.verifyBaseUrl.replace(/\/$/, "")}/${rpKey}`;

      // Forward IDKit JSON as-is — no action/signal rebuild (breaks integrity_bundle).
      const { body: verifyBody } = serializeIdKitVerifyBody(
        payload,
        expectedEnvironment,
        "[idkit/verify]",
      );
      const actionForLog =
        typeof payload.action === "string"
          ? payload.action
          : (i.action ?? cfg.idkit.action);

      const res = await fetchImpl(verifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: verifyBody,
      });

      const rawText = await res.text();
      let verification: {
        success?: boolean;
        environment?: string;
        nullifier?: string;
        code?: string;
        detail?: string;
        message?: string;
        error?: string;
        attribute?: string;
      } = {};
      try {
        verification = rawText ? (JSON.parse(rawText) as typeof verification) : {};
      } catch {
        verification = {};
      }

      const portalCode = String(
        verification.code ?? verification.error ?? verification.detail ?? "",
      ).toLowerCase();
      const replayed =
        /nullifier_replayed|already\s+verified|max_verifications|already\s+completed/.test(
          portalCode,
        ) ||
        /nullifier_replayed|already\s+verified|max_verifications|already\s+completed/i.test(
          rawText,
        );
      const validationStale = /validation_error/.test(portalCode);

      const proofNullifier = extractIdKitProofNullifier(payload);
      const boundHint = i.nullifierHash?.trim();
      const boundClaimMatch =
        validationStale &&
        boundHint &&
        proofNullifier &&
        proofNullifier.toLowerCase() === boundHint.toLowerCase();

      // Gig PoH uniqueness / stale proof: same human already proved → treat as verified.
      if (replayed || validationStale) {
        const replayNullifier =
          (boundClaimMatch ? proofNullifier : null) ??
          verification.nullifier ??
          proofNullifier ??
          (replayed ? boundHint : null);
        if (replayNullifier) {
          console.info("[idkit/verify] nullifier_replayed → already verified", {
            nullifier: replayNullifier.slice(0, 14),
            action: actionForLog,
            environment: expectedEnvironment,
          });
          if (banned.has(replayNullifier)) {
            throw new WorldAuthError("banned_nullifier");
          }
          return {
            nullifierHash: replayNullifier,
            verified: true,
            environment: expectedEnvironment,
            action: String(payload.action ?? i.action ?? cfg.idkit.action),
          };
        }
      }

      if (!res.ok) {
        const reason =
          verification.detail ||
          verification.message ||
          verification.error ||
          verification.code ||
          rawText.slice(0, 400) ||
          `HTTP ${res.status}`;
        console.error("[idkit/verify] Developer Portal rejected", {
          status: res.status,
          url: verifyUrl,
          environment: expectedEnvironment,
          action: actionForLog,
          attribute: verification.attribute,
          publicAppUrl: cfg.publicAppUrl,
          reason,
          body: verification,
          rawText: rawText.slice(0, 2000),
        });
        const code =
          typeof verification.code === "string" && verification.code.trim()
            ? verification.code.trim()
            : "verify_failed";
        throw new WorldAuthError("verify_failed", code);
      }

      if (verification.success !== true) {
        const reason =
          verification.detail ||
          verification.message ||
          verification.error ||
          verification.code ||
          "verification.success !== true";
        console.error("[idkit/verify] success!==true", {
          url: verifyUrl,
          environment: expectedEnvironment,
          action: actionForLog,
          publicAppUrl: cfg.publicAppUrl,
          reason,
          body: verification,
          rawText: rawText.slice(0, 2000),
        });
        const code =
          typeof verification.code === "string" && verification.code.trim()
            ? verification.code.trim()
            : "verify_failed";
        throw new WorldAuthError("verify_failed", code);
      }
      if (
        verification.environment &&
        verification.environment !== expectedEnvironment
      ) {
        throw new WorldAuthError("environment_mismatch");
      }

      const nullifierHash =
        i.nullifierHash ??
        verification.nullifier ??
        extractIdKitProofNullifier(payload);

      if (!nullifierHash) {
        throw new WorldAuthError("missing_nullifier");
      }
      if (banned.has(nullifierHash)) {
        throw new WorldAuthError("banned_nullifier");
      }

      return {
        nullifierHash,
        verified: true,
        environment: expectedEnvironment,
        action: String(payload.action ?? i.action ?? cfg.idkit.action),
      };
    },

    async isBanned(nullifierHash: string) {
      return banned.has(nullifierHash);
    },

    async ban(nullifierHash: string) {
      banned.add(nullifierHash);
    },
  };
}
