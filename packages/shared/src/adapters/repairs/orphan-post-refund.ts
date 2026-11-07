/**
 * One-shot repairs for known orphan pot debits (task lost when escrow was
 * memory-only). Idempotent via `.data/repairs.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AccountBook } from "../accounts/store.js";
import type { Wei } from "../../types.js";

type RepairRow = {
  id: string;
  /** Match potId that starts with this (lowercase). */
  potIdStartsWith: string;
  /** Match potId that ends with this (lowercase). */
  potIdEndsWith: string;
  amountWei: string;
  note: string;
};

/** Known orphan from bearer post 0xab2b… (0.5 HBAR debit, task never persisted). */
const PENDING: RepairRow[] = [
  {
    id: "2026-11-06-ab2b-orphan-debit",
    potIdStartsWith: "0x57bf",
    potIdEndsWith: "f108a",
    amountWei: "50000000",
    note: "Refund 0.5 HBAR — bearer post returned taskId 0xab2b… but escrow was memory-only",
  },
];

type Ledger = { version: 1; applied: string[] };

function ledgerPath(): string | null {
  const accounts = process.env.PROOFWORK_ACCOUNTS_PATH?.trim();
  if (
    accounts === "off" ||
    accounts === "memory" ||
    accounts === ":memory:"
  ) {
    return null;
  }
  const fromEnv = process.env.PROOFWORK_REPAIRS_PATH?.trim();
  if (fromEnv === "off") return null;
  if (fromEnv) return fromEnv;
  try {
    return join(process.cwd(), ".data", "repairs.json");
  } catch {
    return null;
  }
}

function loadLedger(path: string): Ledger {
  if (!existsSync(path)) return { version: 1, applied: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Ledger;
  } catch {
    return { version: 1, applied: [] };
  }
}

function saveLedger(path: string, ledger: Ledger) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2), "utf8");
}

/**
 * Credit pots that were debited for tasks that never survived an MCP restart.
 * Returns how many refunds were applied this boot.
 */
export async function applyOrphanPostRefunds(
  accounts: AccountBook,
): Promise<number> {
  const path = ledgerPath();
  if (!path) return 0;
  const ledger = loadLedger(path);
  let applied = 0;

  for (const row of PENDING) {
    if (ledger.applied.includes(row.id)) continue;
    const hit = accounts.listAccounts().find((a) => {
      const id = a.potId.toLowerCase();
      return (
        id.startsWith(row.potIdStartsWith.toLowerCase()) &&
        id.endsWith(row.potIdEndsWith.toLowerCase())
      );
    });
    if (!hit) continue;
    try {
      await accounts.deposit({
        potId: hit.potId,
        amountWei: BigInt(row.amountWei) as Wei,
        owner: hit.owner,
      });
      ledger.applied.push(row.id);
      applied += 1;
      console.log(
        `[repair] ${row.id}: +${row.amountWei} wei → ${hit.potId} (${row.note})`,
      );
    } catch (err) {
      console.warn(
        `[repair] ${row.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (applied) saveLedger(path, ledger);
  return applied;
}
