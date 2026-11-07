import type {
  FormCardRow,
  FormResponse,
  SubmissionForm,
} from "./submissionForm.js";
import type { Tinybar } from "./money.js";

/** Branded primitive — parse at boundaries, trust inside. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Address = Brand<`0x${string}`, "Address">;
export type PotId = Brand<`0x${string}`, "PotId">;
export type TaskId = Brand<`0x${string}`, "TaskId">;
/**
 * All pot / escrow / approval amounts in-process are **tinybar** (8 decimals).
 * The name `Wei` is legacy (MCP fields still say `rewardWei`, etc.).
 */
export type Wei = Tinybar;
export type Cid = Brand<string, "Cid">;
export type UnixSecs = Brand<number, "UnixSecs">;
export type HcsSequence = Brand<string, "HcsSequence">;
export type AgentPassAttestation = Brand<string, "AgentPassAttestation">;
export type IdKitProof = Brand<string, "IdKitProof">;

export enum EscrowStatus {
  Open = "OPEN",
  Accepted = "ACCEPTED",
  Submitted = "SUBMITTED",
  Verified = "VERIFIED",
  Paid = "PAID",
  Cancelled = "CANCELLED",
  Refunded = "REFUNDED",
  /** Agent refused / timed out — report stub, not a second verifier. */
  Disputed = "DISPUTED",
  /** Gig TTL elapsed before claim / completion. */
  Expired = "EXPIRED",
  /** Posting agent missed respond_sla after evidence — escrow auto-refunded. */
  ExpiredSla = "EXPIRED_SLA",
}

export type Geo = { lat: number; lng: number };

/** Supported gig categories for post / post_gig / board filters. */
export const GIG_CATEGORIES = [
  "photo_proof",
  "shelf_check",
  "field_check",
  "document",
  "data_entry",
  "other",
] as const;
export type GigCategory = (typeof GIG_CATEGORIES)[number];

/** Evidence payload kinds workers/agents may attach (image bytes, file, or text). */
export const EVIDENCE_TYPES = ["image", "file", "text"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type BudgetPot = {
  id: PotId;
  owner: Address;
  balanceWei: Wei;
  spentWei: Wei;
  agentPassThresholdWei: Wei;
};

export type EscrowTask = {
  id: TaskId;
  potId: PotId;
  rewardWei: Wei;
  status: EscrowStatus;
  owner: Address;
  worker: Address | null;
  humanNullifier: string | null;
  resultCid: Cid | null;
  /** Optional advisory TeeML hash — never releases funds by itself. */
  teeVerdictHash: `0x${string}` | null;
  verifyDeadline: UnixSecs | null;
  metadataCid: Cid;
  geo: Geo | null;
  createdAt: UnixSecs;
  /** Set when agent disputes / refuses after evidence. */
  disputeReason?: string | null;
  /**
   * Absolute wall-clock when the gig must be finished.
   * Past this → EXPIRED + pot refund (OPEN or ACCEPTED).
   * Prefer over legacy `expiresAt` when both present.
   */
  deadlineAt?: UnixSecs | null;
  /**
   * @deprecated Alias of deadlineAt — kept so older MCP clients / UI still read.
   * Sweep + create always mirror deadlineAt ↔ expiresAt.
   */
  expiresAt?: UnixSecs | null;
  /** Seconds a worker has after claim before auto-unclaim. */
  maxWorkSecs?: number | null;
  /** Armed on accept: now + maxWorkSecs (extendable via extendClaim). */
  claimExpiresAt?: UnixSecs | null;
  /** When the current claim started (cleared on unclaim). */
  claimedAt?: UnixSecs | null;
  /** Workers who missed claimExpiresAt — permanently barred from reclaiming. */
  blockedWorkers?: Address[];
  /** Seconds posting agent has to all_satisfied / dispute after evidence. */
  respondSlaSecs?: number | null;
  /** Armed on evidence submit when respondSlaSecs is set. */
  respondDeadline?: UnixSecs | null;
  /** HTTPS callback for posting-agent wakeups; absent = in-process wait_task_event only. */
  notifyUrl?: string | null;
  /** GigEscrow.lock tx when GIG_ESCROW_ADDRESS is configured. */
  lockTxHash?: `0x${string}` | null;
  lockExplorerUrl?: string | null;
  /** On-chain payout tx after all_satisfied (HashScan). */
  payoutTxHash?: `0x${string}` | null;
  /** Worker EVM address that received the payout. */
  payoutAddress?: Address | null;
  payoutExplorerUrl?: string | null;
  /**
   * Gig type for board filters. Prefer {@link GIG_CATEGORIES}.
   */
  category?: string | null;
  /** Tags for board filters. */
  tags?: string[];
  /** Short title for board cards (falls back to metadata cid catalog). */
  title?: string | null;
  /** Poster agent label / id for board filter. */
  posterAgent?: string | null;
  /** Optional agent-defined submission form (Google-Forms-like). */
  submissionForm?: SubmissionForm | null;
  /** Worker answers after submit when a form was defined. */
  formResponse?: FormResponse | null;
  /** Set when evidence is submitted — used for dispute messaging policy. */
  submittedAt?: UnixSecs | null;
};

export type ThreadRole = "owner" | "worker" | "agent" | "system";

export type ThreadAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  /** Local store key / relative path — never a public URL alone. */
  storeKey: string;
};

export type ThreadMessage = {
  id: string;
  taskId: TaskId;
  role: ThreadRole;
  body: string;
  attachmentCid: Cid | null;
  /** One or more uploaded files (disk / S3-compatible). */
  attachments?: ThreadAttachment[];
  kind: "chat" | "evidence" | "system" | "form_response";
  /** Structured form submission card (label/value rows). */
  formCard?: FormCardRow[];
  createdAt: UnixSecs;
};

export type SignedTeeVerdict = {
  taskId: TaskId;
  resultHash: `0x${string}`;
  /**
   * Advisory only after hybrid pivot — posting agent `allSatisfied` releases
   * escrow. TeeML must not auto-pay via ecrecover alone.
   */
  approved: boolean;
  signer: Address;
  signature: `0x${string}`;
  /** Optional TeeML request id (legacy / explorer). */
  requestId?: string;
};

export type CreateTaskInput = {
  potId: PotId;
  rewardWei: Wei;
  verifyWindowSecs: number;
  metadataCid: Cid;
  geo?: Geo;
  agentPassProof?: AgentPassAttestation | null;
  owner: Address;
  /** Absolute deadline (required for new posts — gig must be done by). */
  deadlineAt?: UnixSecs | null;
  /**
   * @deprecated Prefer deadlineAt. Mirrored when deadlineAt omitted.
   */
  expiresAt?: UnixSecs | null;
  /** Relative TTL from create → deadlineAt when absolute omitted. */
  ttlSecs?: number | null;
  /** Claim window after accept (required for new posts, e.g. 1800). */
  maxWorkSecs?: number | null;
  /** Posting-agent response SLA after evidence_submitted. */
  respondSlaSecs?: number | null;
  /** HTTPS notify_url for claimed / evidence / paid / … webhooks (optional). */
  notifyUrl?: string | null;
  category?: string | null;
  tags?: string[];
  title?: string | null;
  posterAgent?: string | null;
  /** Optional agent-defined submission form. */
  submissionForm?: SubmissionForm | null;
};

export type TaskQuery = {
  potId?: PotId;
  status?: EscrowStatus[];
  near?: Geo & { radiusM: number };
  /** Inclusive reward range in wei (string/bigint at MCP boundary). */
  rewardMinWei?: Wei;
  rewardMaxWei?: Wei;
  category?: string;
  tags?: string[];
  /** Match tasks whose deadlineAt is on/before this unix. */
  deadlineBefore?: UnixSecs;
  posterAgent?: string;
  /** Case-insensitive substring over title / metadataCid / tags / category. */
  search?: string;
  /** Sort key for board. */
  sort?: "newest" | "reward_desc" | "reward_asc" | "deadline_asc";
};

export type DomainEvent =
  | {
      type: "PotFunded";
      potId: PotId;
      amount: Wei;
      /** External Hedera / payment attestation when UI records a fund. */
      externalTxId?: string;
    }
  | { type: "TaskPosted"; taskId: TaskId; potId: PotId; bounty: Wei; geo?: Geo }
  | { type: "TaskAccepted"; taskId: TaskId; worker: Address; idKitNullifier: string }
  | {
      type: "TaskSubmitted";
      taskId: TaskId;
      verifyDeadline: UnixSecs;
      resultCid: Cid;
      formResponse?: FormResponse | null;
    }
  | { type: "ApprovalRequested"; potId: PotId; taskId: TaskId; amount: Wei }
  | { type: "ApprovalGranted"; potId: PotId; taskId: TaskId }
  | { type: "CancelRequested"; taskId: TaskId; by: Address }
  | { type: "RefundAttempted"; taskId: TaskId; at: UnixSecs }
  | { type: "RefundWon"; taskId: TaskId }
  | { type: "RefundLost"; taskId: TaskId; reason: "already_submitted" | "verified" }
  /** @deprecated TeeML no longer auto-pays; prefer AgentSatisfied. */
  | { type: "Verified"; taskId: TaskId; teeSigner: Address }
  | { type: "AgentSatisfied"; taskId: TaskId; by: Address; note?: string }
  | { type: "TaskDisputed"; taskId: TaskId; by: Address; reason: string }
  | {
      type: "TaskChangesRequested";
      taskId: TaskId;
      by: Address;
      note?: string;
    }
  | {
      type: "TaskDisputeResolved";
      taskId: TaskId;
      by: Address;
      outcome: "release" | "reopen";
    }
  | { type: "Paid"; taskId: TaskId; to: Address; amount: Wei }
  | { type: "TaskExpired"; taskId: TaskId; at: UnixSecs }
  | { type: "SlaBreached"; taskId: TaskId; at: UnixSecs; refunded: true }
  | {
      type: "ClaimExpired";
      taskId: TaskId;
      at: UnixSecs;
      worker: Address;
    }
  | {
      type: "ClaimExtended";
      taskId: TaskId;
      at: UnixSecs;
      claimExpiresAt: UnixSecs;
      by: Address;
    };

/** Webhook / wait_task_event surface — short names for posting agents. */
export type TaskNotifyKind =
  | "posted"
  | "claimed"
  | "claim_expired"
  | "claim_extended"
  | "evidence_submitted"
  | "message"
  | "deadline_soon"
  | "expired"
  | "sla_breach"
  | "paid"
  | "disputed";

export type TaskNotifyEvent = {
  id: string;
  task_id: TaskId;
  event: TaskNotifyKind;
  timestamp: string;
  payload: Record<string, unknown>;
};
