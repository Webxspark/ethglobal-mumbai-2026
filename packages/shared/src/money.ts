/**
 * Hedera amounts: canonical internal unit is **tinybar** (8 decimals).
 * JSON-RPC `tx.value` and `eth_getBalance` use **weibar** (1 tinybar = 1e10 weibar).
 * Hedera contract storage and `uint256` args (e.g. BudgetPot.balance / withdraw) use **tinybar**.
 *
 * Convert only at RPC send boundaries (`wallet.sendTransaction`, fund tx verify).
 */

import type { Brand } from "./types.js";

/** HBAR liquidity in tinybar — single source of truth inside the app. */
export type Tinybar = Brand<bigint, "Tinybar">;

/** 1 HBAR = 10^8 tinybar. */
export const TINYBAR_PER_HBAR = 100_000_000n;

/** 1 tinybar = 10^10 weibar (Hedera EVM JSON-RPC layer). */
export const WEIBAR_PER_TINYBAR = 10_000_000_000n;

const LEGACY_PERSISTED_WEIBAR_MIN = 1_000_000_000_000n;

/**
 * Older JSON persisted pot / escrow / payout amounts as weibar (18-dec aligned)
 * while JSON-RPC `tx.value` is weibar — internal state is always tinybar.
 */
export function likelyLegacyWeibarPersisted(raw: bigint): boolean {
  return (
    raw >= LEGACY_PERSISTED_WEIBAR_MIN && raw % WEIBAR_PER_TINYBAR === 0n
  );
}

export function normalizeLegacyMoneyField(raw: bigint): Tinybar {
  return (likelyLegacyWeibarPersisted(raw)
    ? raw / WEIBAR_PER_TINYBAR
    : raw) as Tinybar;
}

/** @deprecated Prefer {@link normalizeLegacyMoneyField} */
export function maybeTinybarFromLegacyPersisted(raw: bigint): bigint {
  return normalizeLegacyMoneyField(raw);
}

export function weibarFromTinybar(tinybar: bigint): bigint {
  return tinybar * WEIBAR_PER_TINYBAR;
}

export function tinybarFromWeibar(weibar: bigint): bigint {
  if (weibar % WEIBAR_PER_TINYBAR !== 0n) {
    throw new Error("weibar amount must be a whole tinybar multiple");
  }
  return weibar / WEIBAR_PER_TINYBAR;
}

/** Format tinybar as decimal HBAR (no suffix). */
export function formatHbarDecimal(tinybar: bigint, fracDigits = 8): string {
  const neg = tinybar < 0n;
  const abs = neg ? -tinybar : tinybar;
  const whole = abs / TINYBAR_PER_HBAR;
  const frac = abs % TINYBAR_PER_HBAR;
  if (frac === 0n) return `${neg ? "-" : ""}${whole}`;
  const fracStr = frac.toString().padStart(8, "0").replace(/0+$/, "");
  const rounded =
    fracDigits < 8 ? trimFraction(fracStr, fracDigits) : fracStr;
  return `${neg ? "-" : ""}${whole}.${rounded}`;
}

function trimFraction(frac: string, maxDigits: number): string {
  if (maxDigits <= 0) return "";
  const cut = frac.slice(0, maxDigits).replace(/0+$/, "");
  return cut;
}
