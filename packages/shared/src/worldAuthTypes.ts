import type { Address, PotId, TaskId, UnixSecs, Wei } from "./types.js";

/** Linked World Agent Pass subject — store `(iss, sub)` together. */
export type WorldIdentity = {
  iss: string;
  sub: string;
};

export type ApprovalStatus =
  | "pending"
  | "awaiting_world"
  | "approved"
  | "denied"
  | "expired";

/** Denied / failed Agent Pass paths required by World prize brief. */
export type ApprovalDenialReason =
  | "approval_denied"
  | "approval_expired"
  | "stale_auth"
  | "not_owner"
  | "invalid_token"
  | "cancelled"
  | "state_mismatch";

export type HumanDenialReason =
  | "verify_failed"
  | "banned_nullifier"
  | "cancelled"
  | "environment_mismatch"
  | "missing_nullifier"
  | "invalid_proof"
  /** Signup uniqueness already burned and no recoverable session binding. */
  | "signup_already_completed";

export type ApprovalAuthAttempt = {
  state: string;
  nonce: string;
  codeVerifier: string;
  startedAt: UnixSecs;
  redirectUri: string;
};

export type ApprovalRecord = {
  approvalId: string;
  taskId: TaskId;
  potId: PotId;
  amountWei: Wei;
  owner: Address;
  /** When set, completed Agent Pass `(iss,sub)` must match. */
  expectedOwner?: WorldIdentity;
  reason: string;
  status: ApprovalStatus;
  denialReason?: ApprovalDenialReason;
  authorizeUrl?: string;
  createdAt: UnixSecs;
  /** Absolute unix seconds; after this → approval_expired. */
  expiresAt: UnixSecs;
  authAttempt?: ApprovalAuthAttempt;
  result?: {
    identity: WorldIdentity;
    authTime: number;
    acr?: string;
    amr?: string[];
  };
};

export type BeginOwnerApprovalInput = {
  taskId: TaskId;
  potId: PotId;
  amountWei: Wei;
  owner: Address;
  reason: string;
  expectedOwner?: WorldIdentity;
  redirectUri: string;
  /** Override default max age (0 = fresh Continuity step-up). */
  maxAgeSecs?: number;
  /** Approval TTL seconds (default 600 = 10 min). */
  ttlSecs?: number;
};

export type BeginOwnerApprovalResult = {
  approvalId: string;
  authorizeUrl: string;
  expiresAt: UnixSecs;
};

export type CompleteOwnerApprovalInput = {
  approvalId: string;
  code: string;
  state: string;
};

export type CompleteOwnerApprovalResult = {
  approvalId: string;
  identity: WorldIdentity;
  authTime: number;
};

export type AssertAgentPassResult = {
  identity: WorldIdentity;
  authTime: number;
  acr?: string;
  amr?: string[];
};

export type RequireHumanResult = {
  nullifierHash: string;
  verified: true;
  environment: string;
  action: string;
};

/** Forwarded IDKit v4 uniqueness / session payload (do not remap fields). */
export type IdKitVerifyPayload = {
  protocol_version?: string;
  nonce?: string;
  action?: string;
  session_id?: string;
  environment?: string;
  /** Pass through unchanged — required for some credentials; digest covers nonce+protocol_version+responses. */
  integrity_bundle?: unknown;
  responses?: Array<{
    identifier?: string;
    nullifier?: string;
    nullifier_hash?: string;
    session_nullifier?: string[];
    proof?: unknown;
    signal_hash?: string;
    issuer_schema_id?: number;
    expires_at_min?: number;
    merkle_root?: string;
    sybil_score?: number;
  }>;
  [key: string]: unknown;
};

export class WorldAuthError extends Error {
  readonly code: ApprovalDenialReason | HumanDenialReason;

  constructor(
    code: ApprovalDenialReason | HumanDenialReason,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "WorldAuthError";
    this.code = code;
  }
}
