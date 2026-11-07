import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockHcs } from "./mock.js";
import type { TaskId, PotId, Wei } from "../../types.js";

describe("mock HCS", () => {
  it("appends idempotent sequence numbers", async () => {
    const hcs = createMockHcs();
    const event = {
      type: "TaskPosted" as const,
      taskId: "0xtask000000000000000000000000000000000001" as TaskId,
      potId: "0xp0t000000000000000000000000000000000001" as PotId,
      bounty: 1n as Wei,
    };
    const a = await hcs.port.append(event);
    const b = await hcs.port.append(event);
    assert.equal(a.sequenceNumber, b.sequenceNumber);
    assert.match(a.sequenceNumber, /^mock:[0-9a-f]{16}$/);
    const recent = await hcs.readRecent(10);
    assert.equal(recent.length, 1);
  });
});
