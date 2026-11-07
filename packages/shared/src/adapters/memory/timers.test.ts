import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryEscrow } from "./escrow.js";
import { makeFixtureTask } from "../stubs.js";
import {
  EscrowStatus,
  type Address,
  type Cid,
  type UnixSecs,
  type Wei,
} from "../../types.js";

const owner = "0x1111111111111111111111111111111111111111" as Address;
const worker = "0x2222222222222222222222222222222222222222" as Address;
const workerB = "0x3333333333333333333333333333333333333333" as Address;

describe("gig timers", () => {
  it("rejects claim after deadline_at", async () => {
    let now = 1_000 as UnixSecs;
    const escrow = createMemoryEscrow(() => now);
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 1n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy-ttl" as Cid,
      owner,
      deadlineAt: 1_030 as UnixSecs,
      maxWorkSecs: 600,
    });
    assert.equal(task.deadlineAt, 1_030);
    assert.equal(task.expiresAt, 1_030);
    assert.equal(task.maxWorkSecs, 600);
    now = 1_030 as UnixSecs;
    await assert.rejects(
      () =>
        escrow.accept({
          taskId: task.id,
          worker,
          humanNullifier: "n",
        }),
      /expired/i,
    );
    const after = await escrow.get(task.id);
    assert.equal(after.status, EscrowStatus.Expired);
  });

  it("auto-unclaims on max_work_secs and blocks reclaim", async () => {
    let now = 2_000 as UnixSecs;
    const escrow = createMemoryEscrow(() => now);
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 1n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy-claim" as Cid,
      owner,
      deadlineAt: 10_000 as UnixSecs,
      maxWorkSecs: 30,
    });
    const claimed = await escrow.accept({
      taskId: task.id,
      worker,
      humanNullifier: "n-claim",
    });
    assert.equal(claimed.status, EscrowStatus.Accepted);
    assert.equal(claimed.claimExpiresAt, 2_030);

    now = 2_030 as UnixSecs;
    const swept = await escrow.get(task.id);
    assert.equal(swept.status, EscrowStatus.Open);
    assert.equal(swept.worker, null);
    assert.deepEqual(swept.blockedWorkers, [worker]);
    assert.ok(
      escrow.drainEvents().some((e) => e.type === "ClaimExpired"),
    );

    await assert.rejects(
      () =>
        escrow.accept({
          taskId: task.id,
          worker,
          humanNullifier: "n-again",
        }),
      /barred|blocked/i,
    );

    // a different worker can still claim
    const other = await escrow.accept({
      taskId: task.id,
      worker: workerB,
      humanNullifier: "n-b",
    });
    assert.equal(other.worker, workerB);
  });

  it("extendClaim bumps claimExpiresAt (capped by deadline)", async () => {
    let now = 3_000 as UnixSecs;
    const escrow = createMemoryEscrow(() => now);
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 1n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy-ext" as Cid,
      owner,
      deadlineAt: 3_100 as UnixSecs,
      maxWorkSecs: 20,
    });
    await escrow.accept({
      taskId: task.id,
      worker,
      humanNullifier: "n-ext",
    });
    const extended = await escrow.extendClaim({
      taskId: task.id,
      owner,
      extraSecs: 500,
    });
    // capped at deadline 3100, not 3020+500
    assert.equal(extended.claimExpiresAt, 3_100);
  });

  it("SLA breach refunds (not pays) after respond_sla", async () => {
    let now = 5_000 as UnixSecs;
    const escrow = createMemoryEscrow(() => now);
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 2n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy-sla" as Cid,
      owner,
      deadlineAt: 9_000 as UnixSecs,
      maxWorkSecs: 600,
      respondSlaSecs: 10,
    });
    await escrow.accept({
      taskId: task.id,
      worker,
      humanNullifier: "n2",
    });
    const submitted = await escrow.submit({
      taskId: task.id,
      resultCid: "bafy-ev" as Cid,
    });
    assert.equal(submitted.respondDeadline, 5_010);
    assert.equal(submitted.claimExpiresAt, null);
    now = 5_010 as UnixSecs;
    const breached = await escrow.get(task.id);
    assert.equal(breached.status, EscrowStatus.ExpiredSla);
    assert.match(breached.disputeReason ?? "", /SLA breach/);
    const types = escrow.drainEvents().map((e) => e.type);
    assert.ok(types.includes("SlaBreached"));
    assert.ok(types.includes("RefundWon"));
    await assert.rejects(
      () => escrow.allSatisfied({ taskId: task.id, owner }),
      /SLA|blocked/i,
    );
  });
});
