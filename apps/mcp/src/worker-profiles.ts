/**
 * Worker payout addresses — keyed by World session nullifier (and derived
 * worker address). Same process store MCP tools + HTTP tools see.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  EscrowStatus,
  workerFromNullifier,
  type Address,
  type ClaimNullifierStore,
  type EscrowTask,
  type TaskId,
} from "@proofwork/shared";

export type WorkerProfile = {
  userId: string;
  payoutAddress: `0x${string}`;
  updatedAt: number;
};

export type PayoutRecord = {
  taskId: string;
  to: `0x${string}`;
  amountWei: string;
  txHash: `0x${string}`;
  withdrawTxHash?: `0x${string}`;
  at: number;
};

/** Legacy demo fallback — never use as a live claimant / payout key. */
export const DEMO_WORKER =
  "0x2222222222222222222222222222222222222222" as Address;

const profiles = new Map<string, WorkerProfile>();
const payoutsByTask = new Map<string, PayoutRecord>();

type ClaimBindingRow = {
  accountKey: string;
  claimNullifier: string;
  boundAt: number;
};

type DiskShape = {
  version: 1;
  profiles: WorkerProfile[];
  payouts: PayoutRecord[];
  claimBindings?: ClaimBindingRow[];
};

const claimByAccount = new Map<string, string>();
const claimOwnerByNullifier = new Map<string, string>();

function defaultPersistPath(): string | null {
  const fromEnv = process.env.PROOFWORK_WORKER_PROFILES_PATH?.trim();
  if (
    fromEnv === "off" ||
    fromEnv === "memory" ||
    fromEnv === ":memory:"
  ) {
    return null;
  }
  if (fromEnv) return fromEnv;
  try {
    return join(process.cwd(), ".data", "worker-profiles.json");
  } catch {
    return null;
  }
}

function resolvePersistPath(): string | null {
  return defaultPersistPath();
}

function flush() {
  const persistPath = resolvePersistPath();
  if (!persistPath) return;
  try {
    mkdirSync(dirname(persistPath), { recursive: true });
    // Dedupe by userId (map also indexes by payout addr).
    const byUser = new Map<string, WorkerProfile>();
    for (const row of profiles.values()) {
      byUser.set(normUser(row.userId), row);
    }
    const claimBindings: ClaimBindingRow[] = [];
    const seenAccounts = new Set<string>();
    for (const [account, claim] of claimByAccount) {
      if (seenAccounts.has(account)) continue;
      seenAccounts.add(account);
      claimBindings.push({
        accountKey: account,
        claimNullifier: claim,
        boundAt: Date.now(),
      });
    }
    const payload: DiskShape = {
      version: 1,
      profiles: [...byUser.values()],
      payouts: [...payoutsByTask.values()],
      claimBindings,
    };
    writeFileSync(persistPath, JSON.stringify(payload, null, 2), "utf8");
  } catch (err) {
    console.warn("[worker-profiles] failed to persist", err);
  }
}

function hydrate() {
  const persistPath = resolvePersistPath();
  if (!persistPath || !existsSync(persistPath)) return;
  try {
    const raw = readFileSync(persistPath, "utf8");
    const parsed = JSON.parse(raw) as DiskShape;
    for (const row of parsed.profiles ?? []) {
      if (!row?.userId || !row.payoutAddress) continue;
      profiles.set(normUser(row.userId), row);
      profiles.set(normUser(row.payoutAddress), row);
      try {
        const derived = workerFromNullifier(row.userId);
        profiles.set(normUser(derived), row);
      } catch {
        /* userId may already be an address */
      }
    }
    for (const pay of parsed.payouts ?? []) {
      if (!pay?.taskId) continue;
      payoutsByTask.set(pay.taskId.toLowerCase(), pay);
    }
    for (const row of parsed.claimBindings ?? []) {
      if (!row?.accountKey || !row.claimNullifier) continue;
      const account = normUser(row.accountKey);
      const claim = row.claimNullifier.trim();
      claimByAccount.set(account, claim);
      claimOwnerByNullifier.set(normUser(claim), account);
    }
  } catch (err) {
    console.warn("[worker-profiles] failed to load persist file", err);
  }
}

hydrate();

function normUser(id: string): string {
  return id.trim().toLowerCase();
}

/** Legacy demo worker — reject when passed as worker= (use session owner from connect). */
export function isDemoWorkerId(id: string | null | undefined): boolean {
  if (!id) return false;
  return normUser(id) === normUser(DEMO_WORKER);
}

export function setWorkerPayout(
  userId: string,
  payoutAddress: string,
): WorkerProfile {
  const addr = payoutAddress.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
    throw new Error("payoutAddress must be 0x + 40 hex");
  }
  if (isDemoWorkerId(userId)) {
    throw new Error(
      "demo worker id not allowed — use World session nullifier as userId",
    );
  }
  const row: WorkerProfile = {
    userId: userId.trim(),
    payoutAddress: addr as `0x${string}`,
    updatedAt: Date.now(),
  };
  profiles.set(normUser(userId), row);
  // Also index by payout addr + derived worker so all_satisfied can resolve.
  profiles.set(normUser(addr), row);
  try {
    const derived = workerFromNullifier(userId.trim());
    profiles.set(normUser(derived), row);
  } catch {
    /* ignore */
  }
  flush();
  return row;
}

export function getWorkerPayout(userId: string): WorkerProfile | null {
  return profiles.get(normUser(userId)) ?? null;
}

export function getClaimNullifierForAccount(accountKey: string): string | null {
  return claimByAccount.get(normUser(accountKey)) ?? null;
}

export function getAccountForClaimNullifier(
  claimNullifier: string,
): string | null {
  return claimOwnerByNullifier.get(normUser(claimNullifier)) ?? null;
}

/** Persist gig PoH nullifier for a signed-in account (first verify wins). */
export function bindClaimNullifier(
  accountKey: string,
  claimNullifier: string,
): ClaimBindingRow {
  const account = normUser(accountKey);
  const claim = claimNullifier.trim();
  if (!account || !claim) {
    throw new Error("accountKey and claimNullifier required");
  }
  const row: ClaimBindingRow = {
    accountKey: account,
    claimNullifier: claim,
    boundAt: Date.now(),
  };
  claimByAccount.set(account, claim);
  claimOwnerByNullifier.set(normUser(claim), account);
  flush();
  return row;
}

export function claimNullifierStoreFromProfiles(): ClaimNullifierStore {
  return {
    getByAccount: getClaimNullifierForAccount,
    getAccountForClaimNullifier: getAccountForClaimNullifier,
    bind(i) {
      const row = bindClaimNullifier(i.accountKey, i.claimNullifier);
      return {
        accountKey: row.accountKey,
        claimNullifier: row.claimNullifier,
        boundAt: row.boundAt,
      };
    },
  };
}

/** Resolve payout addr from saved profile (nullifier and/or worker id). */
export function resolvePayoutAddress(opts: {
  humanNullifier?: string | null;
  worker?: string | null;
}): `0x${string}` | null {
  if (opts.humanNullifier) {
    const hit = getWorkerPayout(opts.humanNullifier);
    if (hit) return hit.payoutAddress;
    // Claimant may only have been indexed via derived worker.
    try {
      const derived = workerFromNullifier(opts.humanNullifier);
      const viaWorker = getWorkerPayout(derived);
      if (viaWorker) return viaWorker.payoutAddress;
    } catch {
      /* ignore */
    }
  }
  if (opts.worker && !isDemoWorkerId(opts.worker)) {
    const hit = getWorkerPayout(opts.worker);
    if (hit) return hit.payoutAddress;
  }
  return null;
}

export function getTaskPayout(taskId: string): PayoutRecord | null {
  return payoutsByTask.get(taskId.toLowerCase()) ?? null;
}

export function markTaskPayout(row: PayoutRecord): void {
  payoutsByTask.set(row.taskId.toLowerCase(), row);
  flush();
}

export type ClaimRekeyPort = {
  list(q?: { status?: string }): Promise<EscrowTask[]>;
  rekeyClaim(
    taskId: TaskId,
    next: { worker: Address; humanNullifier: string },
  ): EscrowTask;
};

/**
 * Rebind demo-worker claims (and Field check) to the session nullifier so
 * all_satisfied can resolve the saved payout.
 */
export async function repairDemoWorkerClaims(
  escrow: ClaimRekeyPort,
  nullifier: string,
): Promise<{ repaired: string[]; worker: Address }> {
  const nf = nullifier.trim();
  if (!nf) throw new Error("nullifier required");
  const worker = workerFromNullifier(nf);
  const rows = await escrow.list({});
  const repaired: string[] = [];
  for (const t of rows) {
    if (
      t.status !== EscrowStatus.Accepted &&
      t.status !== EscrowStatus.Submitted
    ) {
      continue;
    }
    const title = (t.title ?? "").toLowerCase();
    const demoClaim = isDemoWorkerId(t.worker);
    const fieldCheck = title.includes("field check");
    const stubNull =
      !t.humanNullifier ||
      t.humanNullifier.startsWith("stub-nullifier-") ||
      t.humanNullifier.startsWith("nullifier-2222");
    const sameHuman = t.humanNullifier === nf;
    if (!(demoClaim || fieldCheck) && !sameHuman) continue;
    if (demoClaim || fieldCheck || stubNull || sameHuman) {
      if (t.worker === worker && t.humanNullifier === nf) continue;
      escrow.rekeyClaim(t.id, { worker, humanNullifier: nf });
      repaired.push(t.id);
    }
  }
  return { repaired, worker };
}

/** Test helper — wipe in-memory maps (does not delete disk). */
export function __resetWorkerProfilesForTests(): void {
  profiles.clear();
  payoutsByTask.clear();
  claimByAccount.clear();
  claimOwnerByNullifier.clear();
}
