import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countdownToneClass,
  displayCountdown,
  formatCountdown,
  secsLeft,
} from "./countdown.js";

describe("countdown", () => {
  it("formatCountdown", () => {
    assert.equal(formatCountdown(90), "1m 30s");
    assert.equal(formatCountdown(0), "0s");
    assert.equal(formatCountdown(null), "—");
  });

  it("displayCountdown zero labels", () => {
    assert.equal(displayCountdown(-1, "gig"), "Expired");
    assert.equal(displayCountdown(0, "work"), "Unassigned");
    assert.equal(displayCountdown(42, "gig"), "42s");
  });

  it("countdownToneClass warns under five minutes", () => {
    assert.equal(countdownToneClass(301), undefined);
    assert.equal(countdownToneClass(300), "text-[color:var(--warning)]");
    assert.equal(countdownToneClass(0), "text-destructive");
  });

  it("secsLeft relative to fixed now", () => {
    assert.equal(secsLeft(1_000, 900), 100);
    assert.equal(secsLeft(null, 900), null);
  });
});
