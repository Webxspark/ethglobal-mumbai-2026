import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TINYBAR_PER_HBAR,
  WEIBAR_PER_TINYBAR,
  normalizeLegacyMoneyField,
  tinybarFromWeibar,
  weibarFromTinybar,
} from "./money.js";

describe("hedera money (tinybar canonical)", () => {
  it("converts tinybar ↔ weibar at the RPC boundary", () => {
    const t = 50_000_000n; // 0.5 HBAR
    const w = weibarFromTinybar(t);
    assert.equal(w, 500_000_000_000_000_000n);
    assert.equal(tinybarFromWeibar(w), t);
  });

  it("normalizes legacy persisted weibar to tinybar", () => {
    const legacyBal = 1_101_000_000_000_000_000n; // mis-stored as weibar-aligned
    assert.equal(normalizeLegacyMoneyField(legacyBal), 110_100_000n);
    assert.equal(normalizeLegacyMoneyField(110_100_000n), 110_100_000n);
  });

  it("keeps sub-tinybar RPC values lossless (not coerced)", () => {
    const odd = 1n;
    assert.equal(normalizeLegacyMoneyField(odd), odd);
  });

  it("constants match Hedera docs", () => {
    assert.equal(TINYBAR_PER_HBAR, 100_000_000n);
    assert.equal(WEIBAR_PER_TINYBAR, 10_000_000_000n);
  });

  it("0.5 HBAR release compares to ~11.01 HBAR BudgetPot balance on-chain", () => {
    const potTiny = 1_101_000_000n;
    const rewardTiny = 50_000_000n;
    assert.ok(potTiny >= rewardTiny, "on-chain pot.balance() is tinybar — compare directly");
    assert.ok(weibarFromTinybar(potTiny) >= weibarFromTinybar(rewardTiny));
    assert.equal(rewardTiny, TINYBAR_PER_HBAR / 2n);
  });
});
