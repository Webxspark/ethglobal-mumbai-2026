import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  gigEscrowConfigured,
  taskIdToBytes32,
} from "./onchain-escrow.js";

describe("onchain-escrow wiring", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("taskIdToBytes32 left-pads 20-byte task ids", () => {
    const id = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const b = taskIdToBytes32(id);
    assert.match(b, /^0x[a-fA-F0-9]{64}$/);
    assert.ok(b.toLowerCase().endsWith(id.slice(2).toLowerCase()));
  });

  it("gigEscrowConfigured requires pot + gig escrow addresses", () => {
    delete process.env.GIG_ESCROW_ADDRESS;
    delete process.env.BUDGET_POT_ADDRESS;
    assert.equal(gigEscrowConfigured(), false);

    process.env.GIG_ESCROW_ADDRESS =
      "0xcccccccccccccccccccccccccccccccccccccccc";
    process.env.BUDGET_POT_ADDRESS =
      "0xdddddddddddddddddddddddddddddddddddddddd";
    assert.equal(gigEscrowConfigured(), true);
  });
});
