import type { WorldPassPort } from "../../ports/index.js";
import type { Address, UnixSecs, Wei } from "../../types.js";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import {
  WorldAuthError,
  type ApprovalDenialReason,
  type ApprovalRecord,
  type AssertAgentPassResult,
  type BeginOwnerApprovalInput,
  type BeginOwnerApprovalResult,
  type CompleteOwnerApprovalInput,
  type CompleteOwnerApprovalResult,
  type WorldIdentity,
} from "../../worldAuthTypes.js";
import {
  ApprovalMemoryStore,
  sharedApprovalStore,
} from "./memoryStore.js";
import { identitiesMatch, randomToken } from "./oidc.js";

function nowSecs(): UnixSecs {
  return Math.floor(Date.now() / 1000) as UnixSecs;
}

function parseStubAttestation(attestation: unknown): {
  identity: WorldIdentity;
  authTime: number;
  force?: ApprovalDenialReason;
} {
  if (typeof attestation === "string") {
    // Formats:
    //   stub:iss/sub
    //   stub:deny:approval_denied
    //   stub:stale
    if (attestation.startsWith("stub:deny:")) {
      const reason = attestation.slice("stub:deny:".length) as ApprovalDenialReason;
      return {
        identity: { iss: "https://auth.world.org", sub: "stub-owner" },
        authTime: nowSecs(),
        force: reason,
      };
    }
    if (attestation === "stub:stale") {
      return {
        identity: { iss: "https://auth.world.org", sub: "stub-owner" },
        authTime: nowSecs() - 3600,
        force: "stale_auth",
      };
    }
    if (attestation.startsWith("stub:")) {
      const rest = attestation.slice("stub:".length);
      const [sub, iss] = rest.includes("@")
        ? rest.split("@")
        : [rest || "stub-owner", "https://auth.world.org"];
      return {
        identity: { iss: iss || "https://auth.world.org", sub },
        authTime: nowSecs(),
      };
    }
  }
  if (attestation && typeof attestation === "object") {
    const o = attestation as Record<string, unknown>;
    if (o.stub === true || o.mode === "stub") {
      return {
        identity: {
          iss: String(o.iss ?? "https://auth.world.org"),
          sub: String(o.sub ?? "stub-owner"),
        },
        authTime: Number(o.auth_time ?? nowSecs()),
      };
    }
  }
  // Default stub accept for empty / unknown — demo-friendly.
  return {
    identity: { iss: "https://auth.world.org", sub: "stub-owner" },
    authTime: nowSecs(),
  };
}

export function createStubWorldPass(
  cfg: WorldAuthConfig,
  store: ApprovalMemoryStore = sharedApprovalStore,
): WorldPassPort {
  return {
    async assertAgentPass(i): Promise<AssertAgentPassResult> {
      const parsed = parseStubAttestation(i.attestation);
      if (parsed.force) {
        throw new WorldAuthError(parsed.force);
      }
      if (i.expectedOwner && !identitiesMatch(i.expectedOwner, parsed.identity)) {
        throw new WorldAuthError("not_owner");
      }
      const maxAge = i.maxAgeSecs ?? cfg.agentPass.maxAgeSecs;
      if (maxAge > 0) {
        const age = nowSecs() - parsed.authTime;
        if (age > maxAge + cfg.agentPass.clockToleranceSecs) {
          throw new WorldAuthError("stale_auth");
        }
      }
      return {
        identity: parsed.identity,
        authTime: parsed.authTime,
        acr: "https://world.org/oidc/acr/orb",
        amr: ["worldid-stub"],
      };
    },

    async beginOwnerApproval(
      i: BeginOwnerApprovalInput,
    ): Promise<BeginOwnerApprovalResult> {
      const approvalId = `appr_${randomToken(12)}`;
      const createdAt = nowSecs();
      const ttl = i.ttlSecs ?? cfg.agentPass.approvalTtlSecs;
      const expiresAt = (createdAt + ttl) as UnixSecs;
      const state = randomToken(16);
      const nonce = randomToken(16);
      const codeVerifier = randomToken(32);
      const redirectUri = i.redirectUri || cfg.agentPass.redirectUri;

      // Stub authorize URL hits our callback with a synthetic code.
      const authorizeUrl = new URL(
        "/api/world/approve/callback",
        cfg.publicAppUrl,
      );
      authorizeUrl.searchParams.set("approval_id", approvalId);
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code", `stub-code:${approvalId}`);
      authorizeUrl.searchParams.set("iss", cfg.agentPass.issuer);

      const record: ApprovalRecord = {
        approvalId,
        taskId: i.taskId,
        potId: i.potId,
        amountWei: i.amountWei,
        owner: i.owner,
        expectedOwner: i.expectedOwner,
        reason: i.reason,
        status: "awaiting_world",
        authorizeUrl: authorizeUrl.toString(),
        createdAt,
        expiresAt,
        authAttempt: {
          state,
          nonce,
          codeVerifier,
          startedAt: createdAt,
          redirectUri,
        },
      };
      store.put(record);
      return { approvalId, authorizeUrl: authorizeUrl.toString(), expiresAt };
    },

    async completeOwnerApproval(
      i: CompleteOwnerApprovalInput,
    ): Promise<CompleteOwnerApprovalResult> {
      const record = store.get(i.approvalId);
      if (!record) {
        throw new WorldAuthError("invalid_token", "unknown approvalId");
      }
      if (record.status === "denied") {
        throw new WorldAuthError(record.denialReason ?? "approval_denied");
      }
      if (record.status === "approved" && record.result) {
        return {
          approvalId: record.approvalId,
          identity: record.result.identity,
          authTime: record.result.authTime,
        };
      }
      if (nowSecs() > record.expiresAt) {
        store.update(record.approvalId, {
          status: "expired",
          denialReason: "approval_expired",
        });
        throw new WorldAuthError("approval_expired");
      }
      if (!record.authAttempt || record.authAttempt.state !== i.state) {
        throw new WorldAuthError("state_mismatch");
      }
      if (!i.code.startsWith("stub-code:")) {
        throw new WorldAuthError("invalid_token", "expected stub-code");
      }
      if (i.code.includes(":deny")) {
        store.update(record.approvalId, {
          status: "denied",
          denialReason: "approval_denied",
        });
        throw new WorldAuthError("approval_denied");
      }
      if (i.code.includes(":wrong-owner")) {
        store.update(record.approvalId, {
          status: "denied",
          denialReason: "not_owner",
        });
        throw new WorldAuthError("not_owner");
      }
      if (i.code.includes(":stale")) {
        store.update(record.approvalId, {
          status: "denied",
          denialReason: "stale_auth",
        });
        throw new WorldAuthError("stale_auth");
      }

      const identity: WorldIdentity = record.expectedOwner ?? {
        iss: cfg.agentPass.issuer,
        sub: `stub-owner-${record.owner}`,
      };
      const authTime = nowSecs();
      store.update(record.approvalId, {
        status: "approved",
        result: {
          identity,
          authTime,
          acr: "https://world.org/oidc/acr/orb",
          amr: ["worldid-stub"],
        },
      });
      return { approvalId: record.approvalId, identity, authTime };
    },

    async denyOwnerApproval(i) {
      const record = store.get(i.approvalId);
      if (!record) {
        throw new WorldAuthError("invalid_token", "unknown approvalId");
      }
      if (record.status === "approved") {
        return;
      }
      store.update(i.approvalId, {
        status: "denied",
        denialReason: i.reason,
      });
    },

    async getApproval(approvalId: string): Promise<ApprovalRecord> {
      const record = store.get(approvalId);
      if (!record) {
        throw new WorldAuthError("invalid_token", "unknown approvalId");
      }
      if (
        record.status !== "approved" &&
        record.status !== "denied" &&
        nowSecs() > record.expiresAt
      ) {
        const expired = store.update(approvalId, {
          status: "expired",
          denialReason: "approval_expired",
        });
        return expired!;
      }
      return record;
    },
  };
}

/** Demo helper — fabricate a post-threshold attestation string. */
export function stubAgentPassAttestation(
  owner: Address,
  amountWei: Wei,
): string {
  return `stub:owner-${owner}@https://auth.world.org#${amountWei.toString()}`;
}
