import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIdKitReplayCode, readableIdKitError } from "./idkitErrors.js";

describe("readableIdKitError", () => {
  it("does not surface replay codes as success copy in the UI", () => {
    const msg = readableIdKitError(
      "nullifier_replayed",
      '{"transport":"bridge","responses":[]}',
    );
    assert.equal(msg, "World could not verify the proof.");
    assert.doesNotMatch(msg, /treated as verified/i);
  });

  it("maps binding denial detail keys", () => {
    assert.match(
      readableIdKitError("verify_failed", "claim_nullifier_other_account"),
      /different Proofwork account/,
    );
  });
});

describe("isIdKitReplayCode", () => {
  it("detects replay portal codes", () => {
    assert.equal(isIdKitReplayCode("nullifier_replayed"), true);
    assert.equal(isIdKitReplayCode("max_verifications_reached"), true);
    assert.equal(isIdKitReplayCode("user_rejected"), false);
  });
});
