import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { workerFromNullifier } from "@proofwork/shared";
import {
  DEMO_WORKER,
  __resetWorkerProfilesForTests,
  bindClaimNullifier,
  getAccountForClaimNullifier,
  getClaimNullifierForAccount,
  resolvePayoutAddress,
  setWorkerPayout,
} from "./worker-profiles.js";

describe("worker payout profiles", () => {
  it("resolves by nullifier after set", () => {
    __resetWorkerProfilesForTests();
    setWorkerPayout(
      "nullifier-abc",
      "0x1111111111111111111111111111111111111111",
    );
    const hit = resolvePayoutAddress({
      humanNullifier: "nullifier-abc",
      worker: DEMO_WORKER,
    });
    assert.equal(hit, "0x1111111111111111111111111111111111111111");
  });

  it("resolves via derived worker address", () => {
    __resetWorkerProfilesForTests();
    const nf = "nullifier-derived";
    setWorkerPayout(nf, "0x4444444444444444444444444444444444444444");
    const hit = resolvePayoutAddress({
      humanNullifier: null,
      worker: workerFromNullifier(nf),
    });
    assert.equal(hit, "0x4444444444444444444444444444444444444444");
  });

  it("binds claim nullifier per account", () => {
    __resetWorkerProfilesForTests();
    bindClaimNullifier("sub-worker-a", "0xclaim-null-a");
    assert.equal(getClaimNullifierForAccount("sub-worker-a"), "0xclaim-null-a");
    assert.equal(getAccountForClaimNullifier("0xclaim-null-a"), "sub-worker-a");
  });

  it("does not invent from bare demo worker addr", () => {
    __resetWorkerProfilesForTests();
    const hit = resolvePayoutAddress({
      humanNullifier: "nobody",
      worker: DEMO_WORKER,
    });
    assert.equal(hit, null);
  });
});
