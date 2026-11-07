import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMonitorNextSteps,
  monitorResourceText,
} from "./monitor-hints.js";

describe("monitor-hints", () => {
  it("includes never-ask-owner copy", () => {
    const steps = formatMonitorNextSteps("evt_abc");
    assert.match(steps.instruction, /Start monitoring now/i);
    assert.match(steps.instruction, /cursor evt_abc/);
    assert.match(steps.instruction, /Never ask the owner/i);
    assert.equal(steps.cursor, "evt_abc");
    assert.equal(steps.args.after_id, "evt_abc");
    assert.match(monitorResourceText(), /Never ask the owner/i);
  });
});
