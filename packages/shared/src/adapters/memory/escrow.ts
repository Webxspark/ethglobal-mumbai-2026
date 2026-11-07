import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EscrowPort } from "../../ports/index.js";
import { assertRefundRace, RefundRaceError } from "../../invariants/refundRace.js";
import { matchesTaskQuery, sortTasks } from "../../taskQuery.js";
import { mockTeeSignerAddress } from "../../crypto/verdict.js";
import {
  EscrowStatus,
  type Address,
  type Cid,
  type CreateTaskInput,
  type DomainEvent,
  type EscrowTask,
  type PotId,
  type TaskId,
  type UnixSecs,
  type Wei,
} from "../../types.js";
import { normalizeLegacyMoneyField } from "../../money.js";

export type MemoryEscrowOptions = {
  /** Legacy TeeML signer address — advisory only after hybrid pivot. */
  teeSigner?: Address;
  /** Disk path; null = memory only. Default `.data/escrow-tasks.json`. */
  persistPath?: string | null;
  /** When set, returned escrow to the pot on cancel / expire / SLA refund. */
  potRefund?: (i: {
    potId: PotId;
    amountWei: Wei;
    owner: Address;
  }) => void | Promise<void>;
  /** Called before JSON potRefund on expire / SLA / cancel refund paths. */
  onChainRefund?: (taskId: TaskId) => void | Promise<void>;
};

export type MemoryEscrow = EscrowPort & {
  seed(task: EscrowTask): void;
  /** Drop a task (rollback when pot debit fails after create). */
  removeTask(taskId: TaskId): boolean;
  /**
   * Rebind claimant after demo-worker / key mismatch repair.
   * Only ACCEPTED or SUBMITTED; does not change status or reward.
   */
  rekeyClaim(
    taskId: TaskId,
    next: { worker: Address; humanNullifier: string },
  ): EscrowTask;
  /** Events emitted by the last mutating call (for projectors). */
  drainEvents(): DomainEvent[];
  teeSigner: Address;
  /**
   * Apply deadline / claim-expiry / respond SLA if due.
   * Called lazily from get/accept/submit/list + interval sweeper.
   */
  sweep(taskId: TaskId): Promise<EscrowTask>;
  /** Sweep every known task (interval + list). */
  sweepAll(): Promise<EscrowTask[]>;
  /** How many tasks are currently stored (tests / health). */
  size(): number;
  /** Persist GigEscrow lock receipt on the task row. */
  setOnChainLock(
    taskId: TaskId,
    meta: { lockTxHash: `0x${string}`; lockExplorerUrl?: string | null },
  ): EscrowTask;
};

type DiskTask = {
  id: string;
  potId: string;
  rewardWei: string;
  status: string;
  owner: string;
  worker: string | null;
  humanNullifier: string | null;
  resultCid: string | null;
  teeVerdictHash: string | null;
  verifyDeadline: number | null;
  metadataCid: string;
  geo: { lat: number; lng: number } | null;
  createdAt: number;
  disputeReason: string | null;
  deadlineAt: number | null;
  expiresAt: number | null;
  maxWorkSecs: number | null;
  claimExpiresAt: number | null;
  claimedAt: number | null;
  blockedWorkers: string[];
  respondSlaSecs: number | null;
  respondDeadline: number | null;
  notifyUrl: string | null;
  category: string | null;
  tags: string[];
  title: string | null;
  posterAgent: string | null;
  submissionForm: unknown | null;
  formResponse: unknown | null;
  submittedAt: number | null;
  lockTxHash: string | null;
  lockExplorerUrl: string | null;
};

type DiskShape = { version: 1 | 2; tasks: DiskTask[] };

function newTaskId(): TaskId {
  return (`0x${randomBytes(20).toString("hex")}`) as TaskId;
}

function defaultPersistPath(): string | null {
  const fromEnv = process.env.PROOFWORK_ESCROW_PATH?.trim();
  if (
    fromEnv === "off" ||
    fromEnv === "memory" ||
    fromEnv === ":memory:"
  ) {
    return null;
  }
  if (fromEnv) return fromEnv;
  const accounts = process.env.PROOFWORK_ACCOUNTS_PATH?.trim();
  if (
    accounts === "off" ||
    accounts === "memory" ||
    accounts === ":memory:"
  ) {
    return null;
  }
  try {
    return join(process.cwd(), ".data", "escrow-tasks.json");
  } catch {
    return null;
  }
}

function taskToDisk(t: EscrowTask): DiskTask {
  return {
    id: t.id,
    potId: t.potId,
    rewardWei: t.rewardWei.toString(),
    status: t.status,
    owner: t.owner,
    worker: t.worker,
    humanNullifier: t.humanNullifier,
    resultCid: t.resultCid,
    teeVerdictHash: t.teeVerdictHash,
    verifyDeadline: t.verifyDeadline ?? null,
    metadataCid: t.metadataCid,
    geo: t.geo ?? null,
    createdAt: t.createdAt,
    disputeReason: t.disputeReason ?? null,
    deadlineAt: t.deadlineAt ?? null,
    expiresAt: t.expiresAt ?? null,
    maxWorkSecs: t.maxWorkSecs ?? null,
    claimExpiresAt: t.claimExpiresAt ?? null,
    claimedAt: t.claimedAt ?? null,
    blockedWorkers: [...(t.blockedWorkers ?? [])],
    respondSlaSecs: t.respondSlaSecs ?? null,
    respondDeadline: t.respondDeadline ?? null,
    notifyUrl: t.notifyUrl ?? null,
    category: t.category ?? null,
    tags: [...(t.tags ?? [])],
    title: t.title ?? null,
    posterAgent: t.posterAgent ?? null,
    submissionForm: t.submissionForm ?? null,
    formResponse: t.formResponse ?? null,
    submittedAt: t.submittedAt ?? null,
    lockTxHash: t.lockTxHash ?? null,
    lockExplorerUrl: t.lockExplorerUrl ?? null,
  };
}

function taskFromDisk(
  row: DiskTask,
  legacyPersisted: boolean,
): EscrowTask {
  const dl = row.deadlineAt ?? row.expiresAt ?? null;
  const rewardRaw = BigInt(row.rewardWei);
  const rewardWei = (
    legacyPersisted ? normalizeLegacyMoneyField(rewardRaw) : rewardRaw
  ) as Wei;
  return {
    id: row.id as TaskId,
    potId: row.potId as PotId,
    rewardWei,
    status: row.status as EscrowTask["status"],
    owner: row.owner as Address,
    worker: (row.worker as Address | null) ?? null,
    humanNullifier: row.humanNullifier,
    resultCid: (row.resultCid as Cid | null) ?? null,
    teeVerdictHash: (row.teeVerdictHash as `0x${string}` | null) ?? null,
    verifyDeadline: (row.verifyDeadline as UnixSecs | null) ?? null,
    metadataCid: row.metadataCid as Cid,
    geo: row.geo,
    createdAt: row.createdAt as UnixSecs,
    disputeReason: row.disputeReason,
    deadlineAt: dl as UnixSecs | null,
    expiresAt: dl as UnixSecs | null,
    maxWorkSecs: row.maxWorkSecs,
    claimExpiresAt: (row.claimExpiresAt as UnixSecs | null) ?? null,
    claimedAt: (row.claimedAt as UnixSecs | null) ?? null,
    blockedWorkers: (row.blockedWorkers ?? []) as Address[],
    respondSlaSecs: row.respondSlaSecs,
    respondDeadline: (row.respondDeadline as UnixSecs | null) ?? null,
    notifyUrl: row.notifyUrl,
    category: row.category,
    tags: row.tags ?? [],
    title: row.title,
    posterAgent: row.posterAgent,
    submissionForm: (row.submissionForm as EscrowTask["submissionForm"]) ?? null,
    formResponse: (row.formResponse as EscrowTask["formResponse"]) ?? null,
    submittedAt: (row.submittedAt as UnixSecs | null) ?? null,
    lockTxHash: (row.lockTxHash as `0x${string}` | null) ?? null,
    lockExplorerUrl: row.lockExplorerUrl ?? null,
  };
}

const SLA_STUB_COPY =
  "STUB: SLA breach — posting agent did not all_satisfied or dispute in time. Escrow refunded (not paid). Report placeholder for UI.";

export function createMemoryEscrow(
  clock: () => UnixSecs = () => Math.floor(Date.now() / 1000) as UnixSecs,
  opts: MemoryEscrowOptions = {},
): MemoryEscrow {
  const tasks = new Map<string, EscrowTask>();
  let pendingEvents: DomainEvent[] = [];
  const teeSigner = opts.teeSigner ?? mockTeeSignerAddress();
  const persistPath =
    "persistPath" in opts ? opts.persistPath : defaultPersistPath();
  const potRefund = opts.potRefund;
  const onChainRefund = opts.onChainRefund;

  async function refundPot(task: EscrowTask): Promise<void> {
    if (!potRefund) return;
    if (onChainRefund) {
      await Promise.resolve(onChainRefund(task.id)).catch((err) => {
        console.warn(
          "[escrow] on-chain refund failed:",
          err instanceof Error ? err.message : err,
        );
      });
    }
    await potRefund({
      potId: task.potId,
      amountWei: task.rewardWei,
      owner: task.owner,
    });
  }

  function flush() {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      const payload: DiskShape = {
        version: 2,
        tasks: [...tasks.values()].map(taskToDisk),
      };
      writeFileSync(persistPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.warn("[escrow] failed to persist", err);
    }
  }

  function hydrate() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, "utf8");
      const parsed = JSON.parse(raw) as DiskShape;
      const legacy = parsed.version === 1;
      for (const row of parsed.tasks ?? []) {
        if (!row?.id || !row.potId || !row.owner) continue;
        tasks.set(row.id, taskFromDisk(row, legacy));
      }
    } catch (err) {
      console.warn("[escrow] failed to load persist file", err);
    }
  }

  hydrate();

  function put(task: EscrowTask) {
    tasks.set(task.id, task);
    flush();
  }

  function emit(event: DomainEvent) {
    pendingEvents.push(event);
  }

  function require(taskId: TaskId): EscrowTask {
    const hit = tasks.get(taskId);
    if (!hit) throw new Error(`unknown task ${taskId}`);
    return hit;
  }

  function resolveDeadline(i: CreateTaskInput, now: UnixSecs): UnixSecs | null {
    if (i.deadlineAt != null && i.deadlineAt > 0) return i.deadlineAt;
    if (i.expiresAt != null && i.expiresAt > 0) return i.expiresAt;
    if (i.ttlSecs != null && i.ttlSecs > 0) {
      return (now + i.ttlSecs) as UnixSecs;
    }
    return null;
  }

  function hardDeadline(task: EscrowTask): UnixSecs | null {
    return task.deadlineAt ?? task.expiresAt ?? null;
  }

  function applyExpire(task: EscrowTask, now: UnixSecs): EscrowTask {
    const next: EscrowTask = {
      ...task,
      status: EscrowStatus.Expired,
      disputeReason: task.disputeReason ?? "Gig expired before claim/completion",
      claimExpiresAt: null,
      claimedAt: null,
    };
    put(next);
    emit({ type: "TaskExpired", taskId: next.id, at: now });
    emit({ type: "RefundAttempted", taskId: next.id, at: now });
    emit({ type: "RefundWon", taskId: next.id });
    void Promise.resolve(refundPot(next)).catch((err) => {
      console.warn(
        "[escrow] pot refund after expire failed:",
        err instanceof Error ? err.message : err,
      );
    });
    return next;
  }

  function applySlaBreach(task: EscrowTask, now: UnixSecs): EscrowTask {
    const next: EscrowTask = {
      ...task,
      status: EscrowStatus.ExpiredSla,
      disputeReason: SLA_STUB_COPY,
    };
    put(next);
    emit({ type: "SlaBreached", taskId: next.id, at: now, refunded: true });
    emit({ type: "RefundAttempted", taskId: next.id, at: now });
    emit({ type: "RefundWon", taskId: next.id });
    void Promise.resolve(refundPot(next)).catch((err) => {
      console.warn(
        "[escrow] pot refund after SLA breach failed:",
        err instanceof Error ? err.message : err,
      );
    });
    return next;
  }

  function applyClaimExpiry(task: EscrowTask, now: UnixSecs): EscrowTask {
    const worker = task.worker;
    if (!worker) return task;
    const blocked = [...(task.blockedWorkers ?? [])];
    if (!blocked.includes(worker)) blocked.push(worker);
    const next: EscrowTask = {
      ...task,
      status: EscrowStatus.Open,
      worker: null,
      humanNullifier: null,
      claimExpiresAt: null,
      claimedAt: null,
      blockedWorkers: blocked,
      disputeReason: null,
    };
    put(next);
    emit({ type: "ClaimExpired", taskId: next.id, at: now, worker });
    return next;
  }

  async function sweepOne(taskId: TaskId): Promise<EscrowTask> {
    const task = require(taskId);
    const now = clock();
    const dl = hardDeadline(task);

    // Gig deadline wins over claim window — EXPIRED + refund.
    if (
      (task.status === EscrowStatus.Open ||
        task.status === EscrowStatus.Accepted) &&
      dl != null &&
      now >= dl
    ) {
      return applyExpire(task, now);
    }

    // Missed claim window → auto-unclaim, board again, block that worker.
    if (
      task.status === EscrowStatus.Accepted &&
      task.claimExpiresAt != null &&
      now >= task.claimExpiresAt
    ) {
      return applyClaimExpiry(task, now);
    }

    if (
      task.status === EscrowStatus.Submitted &&
      task.respondDeadline != null &&
      now >= task.respondDeadline
    ) {
      return applySlaBreach(task, now);
    }

    return task;
  }

  const port: MemoryEscrow = {
    teeSigner,

    seed(task) {
      if (tasks.has(task.id)) return; // keep hydrated / prior seed
      const dl = task.deadlineAt ?? task.expiresAt ?? null;
      put({
        ...task,
        deadlineAt: dl,
        expiresAt: dl,
        maxWorkSecs: task.maxWorkSecs ?? null,
        claimExpiresAt: task.claimExpiresAt ?? null,
        claimedAt: task.claimedAt ?? null,
        blockedWorkers: task.blockedWorkers ?? [],
        category: task.category ?? null,
        tags: task.tags ?? [],
        title: task.title ?? null,
        posterAgent: task.posterAgent ?? null,
        submissionForm: task.submissionForm ?? null,
        formResponse: task.formResponse ?? null,
      });
    },

    removeTask(taskId) {
      const ok = tasks.delete(taskId);
      if (ok) flush();
      return ok;
    },

    rekeyClaim(taskId, next) {
      const task = require(taskId);
      if (
        task.status !== EscrowStatus.Accepted &&
        task.status !== EscrowStatus.Submitted
      ) {
        throw new Error(`rekeyClaim blocked from ${task.status}`);
      }
      const patched: EscrowTask = {
        ...task,
        worker: next.worker,
        humanNullifier: next.humanNullifier,
      };
      put(patched);
      return patched;
    },

    size() {
      return tasks.size;
    },

    setOnChainLock(taskId, meta) {
      const task = require(taskId);
      const next: EscrowTask = {
        ...task,
        lockTxHash: meta.lockTxHash,
        lockExplorerUrl: meta.lockExplorerUrl ?? null,
      };
      put(next);
      return next;
    },

    drainEvents() {
      const out = pendingEvents;
      pendingEvents = [];
      return out;
    },

    sweep: sweepOne,

    async sweepAll() {
      const ids = [...tasks.keys()] as TaskId[];
      const out: EscrowTask[] = [];
      for (const id of ids) out.push(await sweepOne(id));
      return out;
    },

    async createTask(i: CreateTaskInput): Promise<EscrowTask> {
      const now = clock();
      if (i.notifyUrl) {
        const u = i.notifyUrl.trim();
        if (u && !/^https?:\/\//i.test(u)) {
          throw new Error("notifyUrl must be http(s)");
        }
      }
      const deadlineAt = resolveDeadline(i, now);
      const maxWorkSecs =
        i.maxWorkSecs != null && i.maxWorkSecs > 0
          ? Math.floor(i.maxWorkSecs)
          : null;
      const respondSlaSecs =
        i.respondSlaSecs != null && i.respondSlaSecs > 0
          ? Math.floor(i.respondSlaSecs)
          : null;

      const tags = (i.tags ?? []).map((t) => String(t).trim()).filter(Boolean);

      const task: EscrowTask = {
        id: newTaskId(),
        potId: i.potId,
        rewardWei: i.rewardWei,
        status: EscrowStatus.Open,
        owner: i.owner,
        worker: null,
        humanNullifier: null,
        resultCid: null,
        teeVerdictHash: null,
        verifyDeadline: null,
        metadataCid: i.metadataCid,
        geo: i.geo ?? null,
        createdAt: now,
        disputeReason: null,
        deadlineAt,
        expiresAt: deadlineAt,
        maxWorkSecs,
        claimExpiresAt: null,
        claimedAt: null,
        blockedWorkers: [],
        respondSlaSecs,
        respondDeadline: null,
        notifyUrl: i.notifyUrl?.trim() || null,
        category: i.category?.trim() || null,
        tags,
        title: i.title?.trim() || null,
        posterAgent: i.posterAgent?.trim() || null,
        submissionForm: i.submissionForm ?? null,
        formResponse: null,
        submittedAt: null,
      };
      put(task);
      emit({
        type: "TaskPosted",
        taskId: task.id,
        potId: task.potId,
        bounty: task.rewardWei,
        geo: task.geo ?? undefined,
      });
      return task;
    },

    async accept(i) {
      const task = await sweepOne(i.taskId);
      if (task.status === EscrowStatus.Expired) {
        throw new Error("accept blocked: task expired");
      }
      if (task.status === EscrowStatus.ExpiredSla) {
        throw new Error("accept blocked: SLA already breached");
      }
      if (task.status !== EscrowStatus.Open) {
        throw new Error(`accept blocked from ${task.status}`);
      }
      const dl = hardDeadline(task);
      if (dl != null && clock() >= dl) {
        throw new Error("accept blocked: task expired");
      }
      const blocked = task.blockedWorkers ?? [];
      if (blocked.includes(i.worker)) {
        throw new Error(
          "accept blocked: worker permanently barred after missing claim window",
        );
      }

      const now = clock();
      const workSecs =
        task.maxWorkSecs != null && task.maxWorkSecs > 0
          ? task.maxWorkSecs
          : null;
      let claimExpiresAt: UnixSecs | null = null;
      if (workSecs != null) {
        claimExpiresAt = (now + workSecs) as UnixSecs;
        // Claim window can't outlive the gig deadline.
        if (dl != null && claimExpiresAt > dl) claimExpiresAt = dl;
      }

      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Accepted,
        worker: i.worker,
        humanNullifier: i.humanNullifier,
        claimedAt: now,
        claimExpiresAt,
      };
      put(next);
      emit({
        type: "TaskAccepted",
        taskId: next.id,
        worker: i.worker,
        idKitNullifier: i.humanNullifier,
      });
      return next;
    },

    async submit(i) {
      const task = await sweepOne(i.taskId);
      if (task.status === EscrowStatus.Expired) {
        throw new Error("submit blocked: task expired");
      }
      if (task.status === EscrowStatus.Open) {
        throw new Error("submit blocked: claim expired — gig returned to board");
      }
      const now = clock();
      assertRefundRace(task, now, "submit");
      const dl = hardDeadline(task);
      if (dl != null && now >= dl) {
        throw new Error("submit blocked: task expired");
      }
      if (
        task.claimExpiresAt != null &&
        now >= task.claimExpiresAt
      ) {
        throw new Error("submit blocked: claim window elapsed");
      }

      const slaSecs =
        task.respondSlaSecs != null && task.respondSlaSecs > 0
          ? task.respondSlaSecs
          : 900;
      const verifyDeadline = (now + slaSecs) as UnixSecs;
      const respondDeadline =
        task.respondSlaSecs != null && task.respondSlaSecs > 0
          ? ((now + task.respondSlaSecs) as UnixSecs)
          : null;

      if (!i.resultCid && !i.formResponse) {
        throw new Error("resultCid or formResponse required");
      }
      const resultCid =
        i.resultCid ??
        (`form-${i.taskId.slice(2, 10)}-${Date.now().toString(16).slice(-6)}` as Cid);

      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Submitted,
        resultCid,
        teeVerdictHash: i.teeVerdict?.resultHash ?? null,
        verifyDeadline,
        respondDeadline,
        // claim timer stops once evidence is in
        claimExpiresAt: null,
        formResponse: i.formResponse ?? null,
        submittedAt: now,
      };
      put(next);
      emit({
        type: "TaskSubmitted",
        taskId: next.id,
        verifyDeadline,
        resultCid,
        formResponse: i.formResponse ?? null,
      });
      return next;
    },

    async verify(_i) {
      throw new Error(
        "TeePathDemoted: TeeML is review input — posting agent must call allSatisfied",
      );
    },

    async allSatisfied(i) {
      const task = await sweepOne(i.taskId);
      if (task.status === EscrowStatus.ExpiredSla) {
        throw new Error("allSatisfied blocked: SLA breach already refunded");
      }
      if (task.status !== EscrowStatus.Submitted) {
        throw new Error(`allSatisfied blocked from ${task.status}`);
      }
      if (i.owner !== task.owner) {
        throw new Error("NotTaskOwner");
      }
      if (!task.worker) {
        throw new Error("missing worker");
      }
      if (!task.resultCid) {
        throw new Error("missing evidence — worker must submit first");
      }

      const verified: EscrowTask = {
        ...task,
        status: EscrowStatus.Verified,
      };
      put(verified);
      emit({
        type: "AgentSatisfied",
        taskId: verified.id,
        by: i.owner,
        note: i.note,
      });

      const paid: EscrowTask = {
        ...verified,
        status: EscrowStatus.Paid,
      };
      put(paid);
      emit({
        type: "Paid",
        taskId: paid.id,
        to: task.worker,
        amount: task.rewardWei,
      });
      return paid;
    },

    async requestChanges(i) {
      const task = await sweepOne(i.taskId);
      if (task.status !== EscrowStatus.Submitted) {
        throw new Error(`requestChanges blocked from ${task.status}`);
      }
      if (i.owner !== task.owner) {
        throw new Error("NotTaskOwner");
      }
      const now = clock();
      const workSecs =
        task.maxWorkSecs != null && task.maxWorkSecs > 0
          ? task.maxWorkSecs
          : 1800;
      const dl = hardDeadline(task);
      let claimExpiresAt = (now + workSecs) as UnixSecs;
      if (dl != null && claimExpiresAt > dl) claimExpiresAt = dl;

      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Accepted,
        resultCid: null,
        formResponse: null,
        teeVerdictHash: null,
        verifyDeadline: null,
        respondDeadline: null,
        submittedAt: null,
        claimExpiresAt,
        claimedAt: task.claimedAt ?? now,
      };
      put(next);
      emit({
        type: "TaskChangesRequested",
        taskId: next.id,
        by: i.owner,
        note: i.note,
      });
      return next;
    },

    async dispute(i) {
      const task = await sweepOne(i.taskId);
      if (
        task.status !== EscrowStatus.Submitted &&
        task.status !== EscrowStatus.Accepted
      ) {
        throw new Error(`dispute blocked from ${task.status}`);
      }
      if (i.owner !== task.owner) {
        throw new Error("NotTaskOwner");
      }
      const reason = (i.reason || "agent refused").slice(0, 280);
      const prevWorker = task.worker;
      const blocked = [...(task.blockedWorkers ?? [])];
      if (prevWorker && !blocked.includes(prevWorker)) {
        blocked.push(prevWorker);
      }
      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Open,
        worker: null,
        humanNullifier: null,
        resultCid: null,
        formResponse: null,
        teeVerdictHash: null,
        verifyDeadline: null,
        respondDeadline: null,
        submittedAt: null,
        claimExpiresAt: null,
        claimedAt: null,
        disputeReason: reason,
        blockedWorkers: blocked,
      };
      put(next);
      emit({
        type: "TaskDisputed",
        taskId: next.id,
        by: i.owner,
        reason,
      });
      return next;
    },

    async resolveDispute(i) {
      const task = await sweepOne(i.taskId);
      if (task.status !== EscrowStatus.Disputed) {
        throw new Error(`resolveDispute blocked from ${task.status}`);
      }
      if (i.owner !== task.owner) {
        throw new Error("NotTaskOwner");
      }

      if (i.outcome === "reopen") {
        const prevWorker = task.worker;
        const blocked = [...(task.blockedWorkers ?? [])];
        if (prevWorker && !blocked.includes(prevWorker)) {
          blocked.push(prevWorker);
        }
        const next: EscrowTask = {
          ...task,
          status: EscrowStatus.Open,
          worker: null,
          humanNullifier: null,
          resultCid: null,
          formResponse: null,
          teeVerdictHash: null,
          verifyDeadline: null,
          respondDeadline: null,
          submittedAt: null,
          claimExpiresAt: null,
          claimedAt: null,
          blockedWorkers: blocked,
        };
        put(next);
        emit({
          type: "TaskDisputeResolved",
          taskId: next.id,
          by: i.owner,
          outcome: "reopen",
        });
        return next;
      }

      if (!task.worker) {
        throw new Error("resolveDispute release blocked: no worker on task");
      }
      const resultCid = i.resultCid ?? task.resultCid;
      if (!resultCid) {
        throw new Error(
          "resolveDispute release blocked: missing resultCid — pass attachment id from thread evidence",
        );
      }
      const now = clock();
      const slaSecs =
        task.respondSlaSecs != null && task.respondSlaSecs > 0
          ? task.respondSlaSecs
          : 900;
      const respondDeadline =
        task.respondSlaSecs != null && task.respondSlaSecs > 0
          ? ((now + task.respondSlaSecs) as UnixSecs)
          : null;
      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Submitted,
        resultCid,
        verifyDeadline: (now + slaSecs) as UnixSecs,
        respondDeadline,
        submittedAt: now,
        disputeReason: null,
      };
      put(next);
      emit({
        type: "TaskDisputeResolved",
        taskId: next.id,
        by: i.owner,
        outcome: "release",
      });
      return next;
    },

    async cancel(i: { taskId: TaskId; caller: Address }): Promise<EscrowTask> {
      const task = await sweepOne(i.taskId);
      const now = clock();
      try {
        assertRefundRace(task, now, "cancel");
      } catch (err) {
        if (err instanceof RefundRaceError && err.reason !== "terminal") {
          emit({
            type: "CancelRequested",
            taskId: task.id,
            by: i.caller,
          });
          emit({ type: "RefundAttempted", taskId: task.id, at: now });
          emit({
            type: "RefundLost",
            taskId: task.id,
            reason: err.reason,
          });
        }
        throw err;
      }

      emit({ type: "CancelRequested", taskId: task.id, by: i.caller });
      emit({ type: "RefundAttempted", taskId: task.id, at: now });
      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Cancelled,
        claimExpiresAt: null,
      };
      put(next);
      emit({ type: "RefundWon", taskId: next.id });
      await refundPot(next);
      return next;
    },

    async expireRefund(i) {
      const task = await sweepOne(i.taskId);
      const now = clock();
      assertRefundRace(task, now, "cancel");
      emit({ type: "RefundAttempted", taskId: task.id, at: now });
      const next: EscrowTask = {
        ...task,
        status: EscrowStatus.Refunded,
        claimExpiresAt: null,
      };
      put(next);
      emit({ type: "RefundWon", taskId: next.id });
      await refundPot(next);
      return next;
    },

    async extendClaim(i) {
      const task = await sweepOne(i.taskId);
      if (task.status !== EscrowStatus.Accepted) {
        throw new Error(`extendClaim blocked from ${task.status}`);
      }
      if (i.owner !== task.owner) {
        throw new Error("NotTaskOwner");
      }
      if (i.extraSecs <= 0 || !Number.isFinite(i.extraSecs)) {
        throw new Error("extraSecs must be a positive number");
      }
      const now = clock();
      const base =
        task.claimExpiresAt != null && task.claimExpiresAt > now
          ? task.claimExpiresAt
          : now;
      let claimExpiresAt = (base + Math.floor(i.extraSecs)) as UnixSecs;
      const dl = hardDeadline(task);
      if (dl != null && claimExpiresAt > dl) claimExpiresAt = dl;
      const next: EscrowTask = {
        ...task,
        claimExpiresAt,
      };
      put(next);
      emit({
        type: "ClaimExtended",
        taskId: next.id,
        at: now,
        claimExpiresAt,
        by: i.owner,
      });
      return next;
    },

    async get(taskId) {
      return sweepOne(taskId);
    },

    async list(q) {
      for (const id of [...tasks.keys()]) {
        await sweepOne(id as TaskId);
      }
      const filtered = [...tasks.values()].filter((t) =>
        matchesTaskQuery(t, q ?? {}),
      );
      return sortTasks(filtered, q?.sort ?? "newest");
    },
  };

  return port;
}
