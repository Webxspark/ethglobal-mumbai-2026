import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchFundTx } from "./match-fund.js";

describe("matchFundTx", () => {
  const pot = "0x1111111111111111111111111111111111111111";
  const owner = "0x2222222222222222222222222222222222222222";

  it("accepts matching successful transfer", () => {
    const hit = matchFundTx(
      {
        from: owner,
        to: pot,
        value: 5_000_000_000_000_000_000n,
        status: "success",
      },
      {
        expectedTo: pot,
        expectedFrom: owner,
        minValueWei: 5_000_000_000_000_000_000n,
      },
    );
    assert.equal(hit.ok, true);
    if (hit.ok) assert.equal(hit.valueWei, 5_000_000_000_000_000_000n);
  });

  it("rejects wrong recipient", () => {
    const hit = matchFundTx(
      {
        from: owner,
        to: "0x3333333333333333333333333333333333333333",
        value: 1n,
        status: "success",
      },
      { expectedTo: pot, minValueWei: 1n },
    );
    assert.equal(hit.ok, false);
  });

  it("rejects underpayment", () => {
    const hit = matchFundTx(
      {
        from: owner,
        to: pot,
        value: 1n,
        status: "success",
      },
      { expectedTo: pot, minValueWei: 2n },
    );
    assert.equal(hit.ok, false);
  });

  it("rejects reverted tx", () => {
    const hit = matchFundTx(
      {
        from: owner,
        to: pot,
        value: 2n,
        status: "reverted",
      },
      { expectedTo: pot, minValueWei: 1n },
    );
    assert.equal(hit.ok, false);
  });

  it("is case-insensitive on addresses", () => {
    const hit = matchFundTx(
      {
        from: owner.toUpperCase(),
        to: pot.toUpperCase(),
        value: 3n,
        status: "success",
      },
      {
        expectedTo: pot,
        expectedFrom: owner,
        minValueWei: 3n,
      },
    );
    assert.equal(hit.ok, true);
  });
});
