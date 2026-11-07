import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EscrowStatus, type EscrowTask, type ThreadMessage } from "../types.js";
import { evaluateDisputeEligibility } from "./disputeEligibility.js";

const taskId = "0xtask" as EscrowTask["id"];

function msg(
  partial: Partial<ThreadMessage> & Pick<ThreadMessage, "role" | "createdAt">,
): ThreadMessage {
  return {
    id: partial.id ?? "m1",
    taskId,
    body: partial.body ?? "hi",
    attachmentCid: null,
    kind: partial.kind ?? "chat",
    createdAt: partial.createdAt,
    role: partial.role,
  };
}

describe("evaluateDisputeEligibility", () => {
  it("blocks dispute on SUBMITTED without prior posting message", () => {
    const task = {
      status: EscrowStatus.Submitted,
      submittedAt: 100 as EscrowTask["createdAt"],
      claimExpiresAt: null,
    } as EscrowTask;
    const hit = evaluateDisputeEligibility({
      task,
      thread: [msg({ role: "worker", createdAt: 100 as EscrowTask["createdAt"], kind: "evidence" })],
      now: 200 as EscrowTask["createdAt"],
    });
    assert.equal(hit.ok, false);
    assert.match(hit.message, /message the worker about the problem first/i);
  });

  it("blocks dispute within 60s of posting message", () => {
    const task = {
      status: EscrowStatus.Submitted,
      submittedAt: 100 as EscrowTask["createdAt"],
    } as EscrowTask;
    const hit = evaluateDisputeEligibility({
      task,
      thread: [
        msg({ role: "worker", createdAt: 100 as EscrowTask["createdAt"], kind: "evidence" }),
        msg({ role: "agent", createdAt: 110 as EscrowTask["createdAt"], body: "retake photo" }),
      ],
      now: 150 as EscrowTask["createdAt"],
    });
    assert.equal(hit.ok, false);
    assert.match(hit.message, /wait \d+s/);
  });

  it("allows dispute after 60s silence", () => {
    const task = {
      status: EscrowStatus.Submitted,
      submittedAt: 100 as EscrowTask["createdAt"],
    } as EscrowTask;
    const hit = evaluateDisputeEligibility({
      task,
      thread: [
        msg({ role: "worker", createdAt: 100 as EscrowTask["createdAt"], kind: "evidence" }),
        msg({ role: "agent", createdAt: 110 as EscrowTask["createdAt"], body: "retake photo" }),
      ],
      now: 180 as EscrowTask["createdAt"],
    });
    assert.equal(hit.ok, true);
  });

  it("allows dispute when claim window elapsed", () => {
    const task = {
      status: EscrowStatus.Accepted,
      claimExpiresAt: 50 as EscrowTask["createdAt"],
    } as EscrowTask;
    const hit = evaluateDisputeEligibility({
      task,
      thread: [],
      now: 60 as EscrowTask["createdAt"],
    });
    assert.equal(hit.ok, true);
  });
});
