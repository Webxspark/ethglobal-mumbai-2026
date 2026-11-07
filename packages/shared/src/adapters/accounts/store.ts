import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address, PotId, UnixSecs, Wei } from "../../types.js";
import type { BudgetPot } from "../../types.js";
import type { PotPort } from "../../ports/index.js";
import { normalizeLegacyMoneyField } from "../../money.js";

/** One World human → one budget pot. Keyed by nullifier. */
export type HumanAccount = {
  readonly nullifierHash: string;
  readonly potId: PotId;
  readonly owner: Address;
  readonly createdAt: UnixSecs;
  readonly label: string | null;
};

export type AccountBook = PotPort & {
  /** First sign-in creates the pot; later calls return the same row. */
  ensureForNullifier(
    nullifierHash: string,
    opts?: { label?: string | null; now?: UnixSecs },
  ): HumanAccount;
  getByNullifier(nullifierHash: string): HumanAccount | null;
  getByPotId(potId: PotId): HumanAccount | null;
  listAccounts(): HumanAccount[];
  /** Threshold knob for Agent Pass (persisted with pot). */
  setThreshold(wei: Wei, potId: PotId): void;
};

export class UnknownPotError extends Error {
  readonly code = "unknown_pot" as const;
  readonly potId: string;
  constructor(potId: string) {
    super("Unknown pot");
    this.name = "UnknownPotError";
    this.potId = potId;
  }
}

export function ownerFromNullifier(nullifierHash: string): Address {
  const digest = createHash("sha256")
    .update(`proofwork:owner:${nullifierHash}`)
    .digest("hex");
  return (`0x${digest.slice(0, 40)}`) as Address;
}

/** Stable escrow worker address from World session sub / nullifier. */
export function workerFromNullifier(nullifierHash: string): Address {
  const digest = createHash("sha256")
    .update(`proofwork:worker:${nullifierHash}`)
    .digest("hex");
  return (`0x${digest.slice(0, 40)}`) as Address;
}

export function potIdFromNullifier(nullifierHash: string): PotId {
  const digest = createHash("sha256")
    .update(`proofwork:pot:${nullifierHash}`)
    .digest("hex");
  return (`0x${digest.slice(0, 40)}`) as PotId;
}

/** New human pots start at 0 HBAR — only verified wallet deposits raise balance. */
const ZERO_BALANCE = 0n as Wei;

function freshPot(i: {
  id: PotId;
  owner: Address;
  balanceWei?: Wei;
  spentWei?: Wei;
  thresholdWei?: Wei;
}): BudgetPot {
  return {
    id: i.id,
    owner: i.owner,
    balanceWei: (i.balanceWei ?? ZERO_BALANCE) as Wei,
    spentWei: (i.spentWei ?? 0n) as Wei,
    agentPassThresholdWei: (i.thresholdWei ?? 100_000_000n) as Wei,
  };
}

type DiskShape = {
  version: 1 | 2;
  pots: Array<{
    id: string;
    owner: string;
    balanceWei: string;
    spentWei: string;
    agentPassThresholdWei: string;
  }>;
  accounts: Array<{
    nullifierHash: string;
    potId: string;
    owner: string;
    createdAt: number;
    label: string | null;
  }>;
  /** taskId → cleared encumbrance (tinybar digits) after on-chain payout */
  finalizedPayouts?: Record<string, string>;
};

function defaultPersistPath(): string | null {
  const raw = process.env.PROOFWORK_ACCOUNTS_PATH?.trim();
  if (raw === "off") return null;
  if (raw) return raw;
  return join(process.cwd(), ".data", "accounts.json");
}

export function createAccountBook(
  clock: () => UnixSecs = () => Math.floor(Date.now() / 1000) as UnixSecs,
  opts: { persistPath?: string | null } = {},
): AccountBook {
  const persistPath =
    opts.persistPath === undefined ? defaultPersistPath() : opts.persistPath;

  const pots = new Map<string, BudgetPot>();
  const byNullifier = new Map<string, HumanAccount>();
  const byPot = new Map<string, HumanAccount>();
  const finalizedPayouts = new Map<string, string>();

  function normEncumbered(raw: Wei): bigint {
    return normalizeLegacyMoneyField(raw);
  }

  function putAccount(row: HumanAccount, pot: BudgetPot) {
    pots.set(row.potId, pot);
    byNullifier.set(row.nullifierHash, row);
    byPot.set(row.potId, row);
  }

  function requirePot(potId: string): BudgetPot {
    const pot = pots.get(potId);
    if (!pot) throw new UnknownPotError(potId);
    return pot;
  }

  function hydrate() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = JSON.parse(readFileSync(persistPath, "utf8")) as DiskShape;
      if (raw.version !== 1 && raw.version !== 2) return;
      const legacy = raw.version === 1;
      for (const p of raw.pots ?? []) {
        const norm = (s: string): Wei => {
          const v = BigInt(s);
          return (legacy ? normalizeLegacyMoneyField(v) : v) as Wei;
        };
        pots.set(p.id, {
          id: p.id as PotId,
          owner: p.owner as Address,
          balanceWei: norm(p.balanceWei),
          spentWei: norm(p.spentWei),
          agentPassThresholdWei: norm(p.agentPassThresholdWei),
        });
      }
      for (const a of raw.accounts ?? []) {
        const row: HumanAccount = {
          nullifierHash: a.nullifierHash,
          potId: a.potId as PotId,
          owner: a.owner as Address,
          createdAt: a.createdAt as UnixSecs,
          label: a.label,
        };
        byNullifier.set(row.nullifierHash, row);
        byPot.set(row.potId, row);
      }
      for (const [taskId, cleared] of Object.entries(
        raw.finalizedPayouts ?? {},
      )) {
        finalizedPayouts.set(taskId.toLowerCase(), cleared);
      }
    } catch (err) {
      console.warn("[accounts] failed to hydrate", err);
    }
  }

  function flush() {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      const payload: DiskShape = {
        version: 2,
        pots: [...pots.values()].map((p) => ({
          id: p.id,
          owner: p.owner,
          balanceWei: p.balanceWei.toString(),
          spentWei: p.spentWei.toString(),
          agentPassThresholdWei: p.agentPassThresholdWei.toString(),
        })),
        accounts: [...byNullifier.values()].map((a) => ({
          nullifierHash: a.nullifierHash,
          potId: a.potId,
          owner: a.owner,
          createdAt: a.createdAt,
          label: a.label,
        })),
        finalizedPayouts: Object.fromEntries(finalizedPayouts),
      };
      writeFileSync(persistPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.warn("[accounts] failed to persist", err);
    }
  }

  hydrate();

  const book: AccountBook = {
    ensureForNullifier(nullifierHash, opts = {}) {
      const key = nullifierHash.trim();
      if (!key) throw new Error("nullifierHash required");
      const hit = byNullifier.get(key);
      if (hit) return hit;

      const owner = ownerFromNullifier(key);
      const potId = potIdFromNullifier(key);
      let id = potId;
      if (pots.has(id) && byPot.get(id)?.nullifierHash !== key) {
        id = (`0x${randomBytes(20).toString("hex")}`) as PotId;
      }
      const existingPot = pots.get(id);
      const pot =
        existingPot ??
        freshPot({ id, owner, balanceWei: ZERO_BALANCE });
      const row: HumanAccount = {
        nullifierHash: key,
        potId: id,
        owner: existingPot?.owner ?? owner,
        createdAt: opts.now ?? clock(),
        label: opts.label?.trim() || null,
      };
      putAccount(row, pot);
      flush();
      return row;
    },

    getByNullifier(nullifierHash) {
      return byNullifier.get(nullifierHash.trim()) ?? null;
    },

    getByPotId(potId) {
      return byPot.get(potId) ?? null;
    },

    listAccounts() {
      return [...byNullifier.values()];
    },

    async deposit({ potId, amountWei, owner }) {
      const pot = requirePot(potId);
      if (owner !== pot.owner) throw new Error("Only pot owner can deposit");
      if (amountWei <= 0n) throw new Error("Invalid amount");
      pots.set(potId, {
        ...pot,
        balanceWei: (pot.balanceWei + amountWei) as Wei,
      });
      flush();
    },

    async withdraw({ potId, amountWei, owner }) {
      const pot = requirePot(potId);
      if (owner !== pot.owner) throw new Error("Only pot owner can withdraw");
      if (amountWei > pot.balanceWei) throw new Error("Insufficient balance");
      pots.set(potId, {
        ...pot,
        balanceWei: (pot.balanceWei - amountWei) as Wei,
        spentWei: (pot.spentWei + amountWei) as Wei,
      });
      flush();
    },

    async refundEncumbered({ potId, amountWei, owner }) {
      const pot = requirePot(potId);
      if (owner !== pot.owner) throw new Error("Only pot owner can deposit");
      const amount = normEncumbered(amountWei);
      if (amount <= 0n) throw new Error("Invalid amount");
      const encumbered = normEncumbered(pot.spentWei);
      if (amount > encumbered) {
        throw new Error("Refund exceeds encumbered spend");
      }
      pots.set(potId, {
        ...pot,
        balanceWei: (pot.balanceWei + amount) as Wei,
        spentWei: (encumbered - amount) as Wei,
      });
      flush();
    },

    async finalizePaidOut({ potId, amountWei, owner, taskId }) {
      const pot = requirePot(potId);
      if (owner !== pot.owner) throw new Error("Only pot owner");
      const amount = normEncumbered(amountWei);
      if (amount <= 0n) throw new Error("Invalid amount");

      const taskKey = taskId?.trim().toLowerCase();
      if (taskKey && finalizedPayouts.has(taskKey)) {
        return;
      }

      const encumbered = normEncumbered(pot.spentWei);
      let clear = amount;

      if (clear > encumbered) {
        if (encumbered === 0n) {
          console.warn(
            `[accounts] finalizePaidOut: no encumbrance on pot ${potId}` +
              (taskKey ? ` task ${taskKey}` : "") +
              ` — recording payout ${clear} tinybar (legacy / missing post debit)`,
          );
          if (taskKey) finalizedPayouts.set(taskKey, clear.toString());
          flush();
          return;
        }
        console.warn(
          `[accounts] finalizePaidOut: payout ${clear} tinybar > encumbered ${encumbered} tinybar on pot ${potId}` +
            (taskKey ? ` task ${taskKey}` : "") +
            " — clamping encumbrance clear",
        );
        clear = encumbered;
      }

      pots.set(potId, {
        ...pot,
        spentWei: (encumbered - clear) as Wei,
      });
      if (taskKey) finalizedPayouts.set(taskKey, clear.toString());
      flush();
    },

    async status(potId) {
      if (!potId) throw new UnknownPotError("(missing)");
      const pot = pots.get(potId);
      if (!pot) throw new UnknownPotError(potId);
      return { ...pot };
    },

    setThreshold(wei: Wei, potId: PotId) {
      if (!potId) throw new UnknownPotError("(missing)");
      const pot = requirePot(potId);
      pots.set(potId, { ...pot, agentPassThresholdWei: wei });
      flush();
    },
  };

  return book;
}

export type AccountBookWithThreshold = AccountBook & {
  setThreshold(wei: Wei, potId: PotId): void;
};
