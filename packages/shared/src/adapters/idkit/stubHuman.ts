import type { HumanPort } from "../../ports/index.js";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import {
  WorldAuthError,
  type IdKitVerifyPayload,
  type RequireHumanResult,
} from "../../worldAuthTypes.js";

const banned = new Set<string>();

function extractNullifier(proof: unknown, explicit?: string): string | null {
  if (explicit) return explicit;
  if (!proof || typeof proof !== "object") {
    if (typeof proof === "string" && proof.startsWith("0x")) return proof;
    return null;
  }
  const p = proof as IdKitVerifyPayload & {
    nullifierHash?: string;
    nullifier_hash?: string;
    stub?: boolean;
  };
  if (typeof p.nullifierHash === "string") return p.nullifierHash;
  if (typeof p.nullifier_hash === "string") return p.nullifier_hash;
  const first = p.responses?.[0];
  if (first?.nullifier) return first.nullifier;
  if (first?.nullifier_hash) return first.nullifier_hash;
  return null;
}

export function createStubHuman(cfg: WorldAuthConfig): HumanPort {
  return {
    async requireHuman(i): Promise<RequireHumanResult> {
      if (
        i.proof &&
        typeof i.proof === "object" &&
        (i.proof as { cancelled?: boolean }).cancelled === true
      ) {
        throw new WorldAuthError("cancelled");
      }

      const nullifierHash = extractNullifier(i.proof, i.nullifierHash);
      if (!nullifierHash) {
        // Demo default when UI has no World keys yet.
        const demo = `0xstub${Buffer.from(
          `${i.signal ?? "worker"}:${cfg.idkit.action}`,
        )
          .toString("hex")
          .slice(0, 56)}`;
        if (banned.has(demo)) {
          throw new WorldAuthError("banned_nullifier");
        }
        return {
          nullifierHash: demo,
          verified: true,
          environment: cfg.idkit.environment,
          action: i.action ?? cfg.idkit.action,
        };
      }

      if (banned.has(nullifierHash)) {
        throw new WorldAuthError("banned_nullifier");
      }

      const env =
        i.proof &&
        typeof i.proof === "object" &&
        typeof (i.proof as IdKitVerifyPayload).environment === "string"
          ? (i.proof as IdKitVerifyPayload).environment!
          : cfg.idkit.environment;

      if (env !== cfg.idkit.environment && env !== "stub") {
        throw new WorldAuthError("environment_mismatch");
      }

      return {
        nullifierHash,
        verified: true,
        environment: env === "stub" ? cfg.idkit.environment : env,
        action: i.action ?? cfg.idkit.action,
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

export function clearStubHumanBans(): void {
  banned.clear();
}
