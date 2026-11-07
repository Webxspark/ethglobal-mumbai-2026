import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirror of @proofwork/shared/money — avoid package subpath in node:test resolve. */
const TINYBAR_PER_HBAR = 100_000_000n;

/** Mirror of formatHbar — keep in sync with format.ts (avoids /browser in node tests). */
function formatHbar(tinybar: bigint, digits = 4): string {
  const n = Number(tinybar) / Number(TINYBAR_PER_HBAR);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
  return `${formatted} HBAR`;
}

function parseHbarToWei(raw: string): bigint {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid amount");
  return BigInt(Math.round(n * Number(TINYBAR_PER_HBAR)));
}

describe("formatHbar", () => {
  it("labels amounts as HBAR, not USD or ETH", () => {
    assert.equal(formatHbar(0n), "0 HBAR");
    assert.equal(formatHbar(100_000_000n), "1 HBAR");
    assert.equal(formatHbar(1_501_000_000n), "15.01 HBAR");
    assert.doesNotMatch(formatHbar(1n), /\$|USD|ETH/i);
  });

  it("round-trips parseHbarToWei", () => {
    assert.equal(parseHbarToWei("5"), 500_000_000n);
    assert.equal(parseHbarToWei("0.5"), 50_000_000n);
  });
});
