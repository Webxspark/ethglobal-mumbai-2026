import type { WorldPassPort } from "../../ports/index.js";
import type { UnixSecs } from "../../types.js";
import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import {
  WorldAuthError,
  type ApprovalRecord,
  type AssertAgentPassResult,
  type BeginOwnerApprovalInput,
  type BeginOwnerApprovalResult,
  type CompleteOwnerApprovalInput,
  type CompleteOwnerApprovalResult,
} from "../../worldAuthTypes.js";
import {
  ApprovalMemoryStore,
  sharedApprovalStore,
} from "./memoryStore.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchDiscovery,
  identitiesMatch,
  pkceChallenge,
  randomToken,
  validateIdToken,
} from "./oidc.js";

function nowSecs(): UnixSecs {
  return Math.floor(Date.now() / 1000) as UnixSecs;
}

export function createLiveWorldPass(
  cfg: WorldAuthConfig,
  store: ApprovalMemoryStore = sharedApprovalStore,
  fetchImpl: typeof fetch = fetch,
): WorldPassPort {
  if (!cfg.agentPass.clientId) {
    throw new Error("WORLD_AGENT_PASS_CLIENT_ID required for live mode");
  }

  return {
    async assertAgentPass(i): Promise<AssertAgentPassResult> {
      const idToken =
        typeof i.attestation === "string"
          ? i.attestation
          : String(
              (i.attestation as { id_token?: string } | null)?.id_token ?? "",
            );
      if (!idToken) {
        throw new WorldAuthError("invalid_token", "missing id_token attestation");
      }
      const discovery = await fetchDiscovery(cfg.agentPass.issuer, fetchImpl);
      const validated = await validateIdToken({
        idToken,
        discovery,
        clientId: cfg.agentPass.clientId,
        maxAgeSecs: i.maxAgeSecs ?? cfg.agentPass.maxAgeSecs,
        attemptStartedAt: nowSecs() - 120,
        clockToleranceSecs: cfg.agentPass.clockToleranceSecs,
      });
      if (i.expectedOwner && !identitiesMatch(i.expectedOwner, validated.identity)) {
        throw new WorldAuthError("not_owner");
      }
      return {
        identity: validated.identity,
        authTime: validated.authTime,
        acr: validated.acr,
        amr: validated.amr,
      };
    },

    async beginOwnerApproval(
      i: BeginOwnerApprovalInput,
    ): Promise<BeginOwnerApprovalResult> {
      const discovery = await fetchDiscovery(cfg.agentPass.issuer, fetchImpl);
      const approvalId = `appr_${randomToken(12)}`;
      const createdAt = nowSecs();
      const ttl = i.ttlSecs ?? cfg.agentPass.approvalTtlSecs;
      const expiresAt = (createdAt + ttl) as UnixSecs;
      const state = randomToken(16);
      const nonce = randomToken(16);
      const codeVerifier = randomToken(32);
      const redirectUri = i.redirectUri || cfg.agentPass.redirectUri;
      const maxAge = i.maxAgeSecs ?? cfg.agentPass.maxAgeSecs;

      // Bind approval id into state so callback can recover without client storage.
      const boundState = `${approvalId}.${state}`;
      const authorizeUrl = buildAuthorizeUrl({
        discovery,
        clientId: cfg.agentPass.clientId,
        redirectUri,
        state: boundState,
        nonce,
        codeChallenge: pkceChallenge(codeVerifier),
        maxAgeSecs: maxAge,
      });

      const record: ApprovalRecord = {
        approvalId,
        taskId: i.taskId,
        potId: i.potId,
        amountWei: i.amountWei,
        owner: i.owner,
        expectedOwner: i.expectedOwner,
        reason: i.reason,
        status: "awaiting_world",
        authorizeUrl,
        createdAt,
        expiresAt,
        authAttempt: {
          state: boundState,
          nonce,
          codeVerifier,
          startedAt: createdAt,
          redirectUri,
        },
      };
      store.put(record);
      return {
        approvalId,
        authorizeUrl,
        expiresAt,
      };
    },

    async completeOwnerApproval(
      i: CompleteOwnerApprovalInput,
    ): Promise<CompleteOwnerApprovalResult> {
      const approvalId =
        i.approvalId ||
        (i.state.includes(".") ? i.state.split(".")[0]! : i.approvalId);
      const record = store.get(approvalId);
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

      const discovery = await fetchDiscovery(cfg.agentPass.issuer, fetchImpl);
      const tokens = await exchangeCode({
        discovery,
        clientId: cfg.agentPass.clientId,
        clientSecret: cfg.agentPass.clientSecret,
        code: i.code,
        redirectUri: record.authAttempt.redirectUri,
        codeVerifier: record.authAttempt.codeVerifier,
        fetchImpl,
      });

      let validated;
      try {
        validated = await validateIdToken({
          idToken: tokens.id_token,
          discovery,
          clientId: cfg.agentPass.clientId,
          expectedNonce: record.authAttempt.nonce,
          maxAgeSecs: cfg.agentPass.maxAgeSecs,
          attemptStartedAt: record.authAttempt.startedAt,
          clockToleranceSecs: cfg.agentPass.clockToleranceSecs,
        });
      } catch (err) {
        const code =
          err instanceof WorldAuthError ? err.code : "invalid_token";
        store.update(record.approvalId, {
          status: "denied",
          denialReason: code as ApprovalRecord["denialReason"],
        });
        throw err;
      }

      if (
        record.expectedOwner &&
        !identitiesMatch(record.expectedOwner, validated.identity)
      ) {
        store.update(record.approvalId, {
          status: "denied",
          denialReason: "not_owner",
        });
        throw new WorldAuthError("not_owner");
      }

      store.update(record.approvalId, {
        status: "approved",
        result: {
          identity: validated.identity,
          authTime: validated.authTime,
          acr: validated.acr,
          amr: validated.amr,
        },
      });

      return {
        approvalId: record.approvalId,
        identity: validated.identity,
        authTime: validated.authTime,
      };
    },

    async denyOwnerApproval(i) {
      const record = store.get(i.approvalId);
      if (!record) {
        throw new WorldAuthError("invalid_token", "unknown approvalId");
      }
      if (record.status === "approved") return;
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
        return store.update(approvalId, {
          status: "expired",
          denialReason: "approval_expired",
        })!;
      }
      return record;
    },
  };
}
