import type { X402Decision, X402Env, X402Gate, PaidToolName } from "./types.js";
import { buildRequirements, serializeChallenge } from "./requirements.js";
import { REQUEST_HEADER } from "./types.js";

/**
 * Live Hedera x402 gate.
 * Until facilitator settle is wired, decide returns a short challenge —
 * never advise a demo payment token or name a specific asset ticker.
 */
export function createLiveX402Gate(env: X402Env): X402Gate {
  return {
    async decide({ tool, headers }): Promise<X402Decision> {
      const reqs = buildRequirements(tool, env);
      const raw = headers[REQUEST_HEADER] ?? headers["X-PAYMENT"];
      if (!raw || raw.trim() === "") {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "X-PAYMENT header is required"),
        };
      }

      // Demo shortcut only works in mock mode — refuse the literal token live.
      if (raw.trim() === "mock") {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "invalid X-PAYMENT payload"),
        };
      }

      // Live path: dynamic-import facilitator clients when packages are present.
      // Keep compile-safe without optional deps installed.
      try {
        // TODO: dynamic import `@x402/core/server` + `@x402/hedera/exact/server`
        // verify → settle against env.facilitatorUrl, ExactHederaScheme
        void (tool as PaidToolName);
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "payment settlement unavailable"),
        };
      } catch (err) {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(
            reqs,
            err instanceof Error ? err.message : "payment settlement failed",
          ),
        };
      }
    },

    async settle() {
      // settle happens inside decide for live once facilitator is wired
    },
  };
}
