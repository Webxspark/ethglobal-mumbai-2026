import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatWorkWindowLabel,
  secsUntil,
  taskTimerFields,
} from "./taskTimers.js";

describe("taskTimers", () => {
  it("secsUntil clamps past deadlines to zero", () => {
    assert.equal(secsUntil(100, 200), 0);
    assert.equal(secsUntil(300, 200), 100);
    assert.equal(secsUntil(null, 200), null);
  });

  it("taskTimerFields mirrors snake and camel", () => {
    const snap = taskTimerFields(
      {
        deadlineAt: 1_000,
        expiresAt: 1_000,
        claimExpiresAt: 1_050,
        respondDeadline: 1_200,
      },
      900,
    );
    assert.equal(snap.expires_remaining_secs, 100);
    assert.equal(snap.expiresRemainingSecs, 100);
    assert.equal(snap.claim_remaining_secs, 150);
    assert.equal(snap.respond_remaining_secs, 300);
  });

  it("formatWorkWindowLabel", () => {
    assert.equal(formatWorkWindowLabel(1800), "30m");
    assert.equal(formatWorkWindowLabel(3600), "1h");
    assert.equal(formatWorkWindowLabel(45), "45s");
    assert.equal(formatWorkWindowLabel(null), null);
  });
});
