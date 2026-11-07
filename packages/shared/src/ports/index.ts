import type {
  Address,
  AgentPassAttestation,
  BudgetPot,
  Cid,
  CreateTaskInput,
  DomainEvent,
  EscrowTask,
  IdKitProof,
  PotId,
  SignedTeeVerdict,
  TaskId,
  TaskQuery,
  ThreadMessage,
  ThreadRole,
  Wei,
} from "../types.js";
import type {
  ApprovalDenialReason,
  ApprovalRecord,
  AssertAgentPassResult,
  BeginOwnerApprovalInput,
  BeginOwnerApprovalResult,
  CompleteOwnerApprovalInput,
  CompleteOwnerApprovalResult,
  RequireHumanResult,
  WorldIdentity,
} from "../worldAuthTypes.js";

export interface PotPort {
  deposit(i: { potId: PotId; amountWei: Wei; owner: Address }): Promise<void>;
  /** Posting a gig — moves amount from liquid balance into encumbered spend. */
  withdraw(i: { potId: PotId; amountWei: Wei; owner: Address }): Promise<void>;
  /** Cancel / expiry / SLA refund — returns encumbered amount to liquid balance. */
  refundEncumbered(i: {
    potId: PotId;
    amountWei: Wei;
    owner: Address;
  }): Promise<void>;
  /** Worker paid on-chain — clears encumbrance without crediting liquid (already left at post). */
  finalizePaidOut(i: {
    potId: PotId;
    amountWei: Wei;
    owner: Address;
    /** Idempotency + audit when on-chain payout already landed. */
    taskId?: TaskId;
  }): Promise<void>;
  status(potId: PotId): Promise<BudgetPot>;
}

export interface EscrowPort {
  createTask(i: CreateTaskInput): Promise<EscrowTask>;
  accept(i: {
    taskId: TaskId;
    worker: Address;
    humanNullifier: string;
    /** IDKit verify payload — required when routing through web /api/worker/accept. */
    proof?: unknown;
    signal?: Address;
    action?: string;
  }): Promise<EscrowTask>;
  submit(i: {
    taskId: TaskId;
    /** Required when no submission form; att_ id or synthetic form-* when using form_response. */
    resultCid?: Cid;
    /** Optional advisory TeeML — review input only, never auto-pays. */
    teeVerdict?: SignedTeeVerdict | null;
    /** Validated form answers when the gig defined submissionForm. */
    formResponse?: import("../submissionForm.js").FormResponse | null;
  }): Promise<EscrowTask>;
  /**
   * @deprecated Hybrid pivot — TeeML ecrecover alone must not release funds.
   * Memory/MCP throw TeePathDemoted; use `allSatisfied`.
   */
  verify(i: {
    taskId: TaskId;
    owner: Address;
    teeSig: `0x${string}`;
  }): Promise<EscrowTask>;
  /**
   * Posting-party agent happy path. ONLY release that pays the worker.
   * Evidence in the thread is review input; agent decides.
   */
  allSatisfied(i: {
    taskId: TaskId;
    owner: Address;
    note?: string;
  }): Promise<EscrowTask>;
  /**
   * Agent refuses after worker ignored thread — unassigns worker, reopens OPEN
   * (escrow stays locked; prior worker blocked from reclaim).
   */
  dispute(i: {
    taskId: TaskId;
    owner: Address;
    reason: string;
  }): Promise<EscrowTask>;
  /** Wrong evidence while SUBMITTED → back to ACCEPTED for resubmit. */
  requestChanges(i: {
    taskId: TaskId;
    owner: Address;
    note?: string;
  }): Promise<EscrowTask>;
  /** Clear legacy DISPUTED — release (pay worker) or reopen board. */
  resolveDispute(i: {
    taskId: TaskId;
    owner: Address;
    outcome: "release" | "reopen";
    resultCid?: Cid | null;
    note?: string;
  }): Promise<EscrowTask>;
  cancel(i: { taskId: TaskId; caller: Address }): Promise<EscrowTask>;
  expireRefund(i: { taskId: TaskId }): Promise<EscrowTask>;
  /** Posting agent: bump claimExpiresAt after chatting with the worker. */
  extendClaim(i: {
    taskId: TaskId;
    owner: Address;
    extraSecs: number;
  }): Promise<EscrowTask>;
  get(taskId: TaskId): Promise<EscrowTask>;
  list(q: TaskQuery): Promise<EscrowTask[]>;
}

/** Upwork-shaped task thread — chat + evidence attachments. */
export interface ThreadPort {
  post(i: {
    taskId: TaskId;
    role: ThreadRole;
    body: string;
    attachmentCid?: Cid | null;
    attachments?: ThreadMessage["attachments"];
    kind?: ThreadMessage["kind"];
    formCard?: ThreadMessage["formCard"];
  }): Promise<ThreadMessage>;
  list(taskId: TaskId): Promise<ThreadMessage[]>;
}

/**
 * World Agent Pass (Continuity / classic OIDC).
 * Over-threshold spend + request_approval owner step-up.
 */
export interface WorldPassPort {
  assertAgentPass(i: {
    owner: Address;
    amountWei: Wei;
    attestation: AgentPassAttestation | unknown;
    expectedOwner?: WorldIdentity;
    maxAgeSecs?: number;
  }): Promise<AssertAgentPassResult>;

  beginOwnerApproval(
    i: BeginOwnerApprovalInput,
  ): Promise<BeginOwnerApprovalResult>;

  completeOwnerApproval(
    i: CompleteOwnerApprovalInput,
  ): Promise<CompleteOwnerApprovalResult>;

  denyOwnerApproval(i: {
    approvalId: string;
    reason: ApprovalDenialReason;
  }): Promise<void>;

  getApproval(approvalId: string): Promise<ApprovalRecord>;
}

/** IDKit Proof of Human — required before EscrowPort.accept. */
export interface HumanPort {
  requireHuman(i: {
    nullifierHash?: string;
    proof: IdKitProof | unknown;
    signal?: string;
    action?: string;
  }): Promise<RequireHumanResult>;

  isBanned(nullifierHash: string): Promise<boolean>;

  ban(nullifierHash: string, reason?: string): Promise<void>;
}

export interface TeePort {
  scoreSubmission(i: {
    taskId: TaskId;
    payload: unknown;
  }): Promise<SignedTeeVerdict>;
}

export interface HcsAuditPort {
  append(event: DomainEvent): Promise<{ sequenceNumber: string }>;
}

export interface ArkivPort {
  upsertTaskEntity(task: EscrowTask): Promise<void>;
  nearby(q: {
    lat: number;
    lng: number;
    radiusM: number;
  }): Promise<TaskId[]>;
}

export interface X402PaymentPort {
  requirePayment(i: {
    tool: string;
    payer: string;
  }): Promise<{ receipt: string }>;
}
