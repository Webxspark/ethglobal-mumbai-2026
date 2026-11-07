import type { WorldAuthConfig } from "../../env/worldAuthConfig.js";
import {
  WorldAuthError,
  type IdKitVerifyPayload,
} from "../../worldAuthTypes.js";
import { serializeIdKitVerifyBody } from "./forwardVerify.js";
import {
  sharedWorldSessionRegistry,
  type WorldSessionRegistry,
} from "./sessionRegistry.js";

export type SignInKind = "enrollment" | "session";

export type VerifyWorldSignInResult = {
  nullifierHash: string;
  sessionId: string;
  kind: SignInKind;
  verified: true;
  environment: string;
  action: string | null;
};

function asPayload(proof: unknown): IdKitVerifyPayload {
  if (!proof || typeof proof !== "object") {
    throw new WorldAuthError("invalid_proof", "expected IDKit payload object");
  }
  return proof as IdKitVerifyPayload;
}

function extractEnrollmentNullifier(payload: IdKitVerifyPayload): string | null {
  const first = payload.responses?.[0] as
    | { nullifier?: string; nullifier_hash?: string }
    | undefined;
  return first?.nullifier ?? first?.nullifier_hash ?? null;
}

function extractSessionNullifier(payload: IdKitVerifyPayload): string | null {
  const first = payload.responses?.[0] as
    | { session_nullifier?: string[] }
    | undefined;
  const sn = first?.session_nullifier;
  if (!Array.isArray(sn) || sn.length < 1) return null;
  // Docs: session_nullifier is [nullifier, action] — replay-protect on the pair.
  return sn.join(":");
}

function extractSessionId(payload: IdKitVerifyPayload): string | null {
  const raw = payload.session_id;
  return typeof raw === "string" && raw.startsWith("session_") ? raw : null;
}

/**
 * Verify a World ID sign-in proof (enrollment uniqueness+session create, or
 * returning session prove). Portal cryptographically validates the proof;
 * we map to a stable nullifier-keyed account.
 */
export async function verifyWorldSignIn(i: {
  cfg: WorldAuthConfig;
  proof: unknown;
  expectedAction?: string;
  registry?: WorldSessionRegistry;
  fetchImpl?: typeof fetch;
}): Promise<VerifyWorldSignInResult> {
  const registry = i.registry ?? sharedWorldSessionRegistry;
  const fetchImpl = i.fetchImpl ?? fetch;
  const payload = asPayload(i.proof);
  const expectedEnvironment = i.cfg.idkit.environment;
  const expectedAction =
    i.expectedAction ?? i.cfg.idkit.signinAction ?? "proofwork-login";

  if (
    payload.environment &&
    payload.environment !== expectedEnvironment &&
    payload.environment !== "stub"
  ) {
    throw new WorldAuthError("environment_mismatch");
  }

  const sessionIdFromProof = extractSessionId(payload);
  const hasAction =
    typeof payload.action === "string" && payload.action.length > 0;
  // Uniqueness enrollment (optionally with session_id: "create") carries action.
  // Returning session proofs carry session_id only.
  if (!hasAction && !sessionIdFromProof) {
    throw new WorldAuthError(
      "invalid_proof",
      "proof needs an action (signup) or session_id (return)",
    );
  }
  const kind: SignInKind = hasAction ? "enrollment" : "session";

  // Test/stub payloads (never sent to Portal).
  if (payload.environment === "stub") {
    return verifyStubSignIn({
      payload,
      kind,
      expectedEnvironment,
      expectedAction,
      registry,
    });
  }

  const rpKey = i.cfg.idkit.rpId || i.cfg.idkit.appId;
  const verifyUrl = `${i.cfg.idkit.verifyBaseUrl.replace(/\/$/, "")}/${rpKey}`;

  // Portal integrity digests nonce+protocol_version+responses — forward IDKit JSON as-is.
  const { body: verifyBody } = serializeIdKitVerifyBody(
    payload,
    expectedEnvironment,
    "[idkit/signin]",
  );

  const res = await fetchImpl(verifyUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: verifyBody,
  });

  const rawText = await res.text();
  let verification: {
    success?: boolean;
    environment?: string;
    nullifier?: string;
    session_id?: string;
    code?: string;
    detail?: string;
    message?: string;
    error?: string;
    results?: Array<{ nullifier?: string; code?: string; detail?: string }>;
  } = {};
  try {
    verification = rawText ? (JSON.parse(rawText) as typeof verification) : {};
  } catch {
    verification = {};
  }

  if (!res.ok || verification.success !== true) {
    const code = verification.code || "verify_failed";
    const reason =
      verification.detail ||
      verification.message ||
      verification.error ||
      code ||
      rawText.slice(0, 400) ||
      `HTTP ${res.status}`;

    // Portal may reject a replayed uniqueness nullifier. Cross-device recovery:
    // if we already bound this nullifier → session during enrollment, treat as
    // a returning login and hand the session_id back so the browser can persist it.
    if (
      kind === "enrollment" &&
      /nullifier_replayed|already\s+verified|max_verifications|already\s+completed/i.test(
        `${code} ${reason}`,
      )
    ) {
      const nullifierHash =
        verification.nullifier ||
        verification.results?.[0]?.nullifier ||
        extractEnrollmentNullifier(payload);
      if (nullifierHash) {
        const bound = registry.getByNullifier(nullifierHash);
        if (bound) {
          return {
            nullifierHash: bound.nullifierHash,
            sessionId: bound.sessionId,
            kind: "session",
            verified: true,
            environment: expectedEnvironment,
            action: expectedAction,
          };
        }
      }
      // No localStorage session + no server binding → clear, non-dead-end error.
      // Hosts can point WORLD_IDKIT_SIGNIN_ACTION at a fresh Portal action
      // (default proofwork-login) so this human can create a session here.
      throw new WorldAuthError(
        "signup_already_completed",
        reason ||
          `action ${expectedAction} already completed with no recoverable session`,
      );
    }

    console.error("[idkit/signin] Developer Portal rejected", {
      status: res.status,
      url: verifyUrl,
      environment: expectedEnvironment,
      kind,
      reason,
      body: verification,
    });
    throw new WorldAuthError("verify_failed", reason);
  }

  if (
    verification.environment &&
    verification.environment !== expectedEnvironment
  ) {
    throw new WorldAuthError("environment_mismatch");
  }

  if (kind === "enrollment") {
    const action = String(payload.action ?? "");
    if (action && action !== expectedAction) {
      throw new WorldAuthError(
        "verify_failed",
        `unexpected action ${action} (expected ${expectedAction})`,
      );
    }
    const nullifierHash =
      verification.nullifier || extractEnrollmentNullifier(payload);
    const sessionId =
      verification.session_id || sessionIdFromProof || null;
    if (!nullifierHash) throw new WorldAuthError("missing_nullifier");
    if (!sessionId) {
      throw new WorldAuthError(
        "verify_failed",
        "enrollment proof missing session_id — request with session_id: \"create\"",
      );
    }
    const bound = registry.bindEnrollment({ sessionId, nullifierHash });
    return {
      nullifierHash: bound.nullifierHash,
      sessionId: bound.sessionId,
      kind: "enrollment",
      verified: true,
      environment: expectedEnvironment,
      action: expectedAction,
    };
  }

  // Returning session proof
  const sessionId = verification.session_id || sessionIdFromProof;
  if (!sessionId) {
    throw new WorldAuthError("verify_failed", "session proof missing session_id");
  }
  const bound = registry.getBySession(sessionId);
  if (!bound) {
    throw new WorldAuthError(
      "verify_failed",
      "session_unknown: prove a session created during signup",
    );
  }
  const sessionNullifier = extractSessionNullifier(payload);
  if (!sessionNullifier) {
    throw new WorldAuthError(
      "verify_failed",
      "session proof missing session_nullifier",
    );
  }
  if (!registry.consumeSessionNullifier(sessionNullifier)) {
    throw new WorldAuthError(
      "verify_failed",
      "session_nullifier_replayed",
    );
  }

  return {
    nullifierHash: bound.nullifierHash,
    sessionId: bound.sessionId,
    kind: "session",
    verified: true,
    environment: expectedEnvironment,
    action: null,
  };
}

function verifyStubSignIn(i: {
  payload: IdKitVerifyPayload;
  kind: SignInKind;
  expectedEnvironment: string;
  expectedAction: string;
  registry: WorldSessionRegistry;
}): VerifyWorldSignInResult {
  if (i.kind === "enrollment") {
    const nullifierHash = extractEnrollmentNullifier(i.payload);
    const sessionId =
      extractSessionId(i.payload) ||
      (`session_${"0".repeat(128)}` as const);
    if (!nullifierHash) throw new WorldAuthError("missing_nullifier");
    const bound = i.registry.bindEnrollment({
      sessionId,
      nullifierHash,
    });
    return {
      nullifierHash: bound.nullifierHash,
      sessionId: bound.sessionId,
      kind: "enrollment",
      verified: true,
      environment: i.expectedEnvironment,
      action: i.expectedAction,
    };
  }

  const sessionId = extractSessionId(i.payload);
  if (!sessionId) {
    throw new WorldAuthError("verify_failed", "session proof missing session_id");
  }
  let bound = i.registry.getBySession(sessionId);
  if (!bound) {
    // Stub convenience: invent a stable nullifier from the session id.
    const digest = sessionId.replace(/^session_/, "").slice(0, 64);
    const nullifierHash = `0x${digest.padEnd(64, "0")}`;
    bound = i.registry.bindEnrollment({ sessionId, nullifierHash });
  }
  const sessionNullifier =
    extractSessionNullifier(i.payload) || `stub-sn:${sessionId}:${Date.now()}`;
  if (!i.registry.consumeSessionNullifier(sessionNullifier)) {
    throw new WorldAuthError("verify_failed", "session_nullifier_replayed");
  }
  return {
    nullifierHash: bound.nullifierHash,
    sessionId: bound.sessionId,
    kind: "session",
    verified: true,
    environment: i.expectedEnvironment,
    action: null,
  };
}
