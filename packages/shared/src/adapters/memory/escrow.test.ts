import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createMemoryEscrow } from "./escrow.js";
import { makeFixtureTask } from "../stubs.js";
import { EscrowStatus, type Address, type UnixSecs, type Wei } from "../../types.js";
import { RefundRaceError } from "../../invariants/refundRace.js";

describe("memory escrow", () => {
  it("creates OPEN tasks and emits TaskPosted", async () => {
    const escrow = createMemoryEscrow(() => 1_700_000_000 as UnixSecs, {
      persistPath: null,
    });
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 10000n as Wei,
      verifyWindowSecs: 3600,
      metadataCid: "bafy-demo" as never,
      geo: { lat: 19.076, lng: 72.877 },
      owner: "0x1111111111111111111111111111111111111111" as Address,
    });
    assert.equal(task.status, EscrowStatus.Open);
    const events = escrow.drainEvents();
    assert.equal(events[0]?.type, "TaskPosted");
  });

  it("persists tasks across store restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "escrow-"));
    const path = join(dir, "escrow-tasks.json");
    const a = createMemoryEscrow(() => 1_700_000_000 as UnixSecs, {
      persistPath: path,
    });
    const created = await a.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 50_000_000n as Wei,
      verifyWindowSecs: 3600,
      metadataCid: "bafy-persist" as never,
      geo: { lat: 19.07, lng: 72.87 },
      owner: "0x1111111111111111111111111111111111111111" as Address,
      title: "Persist me",
    });
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      tasks: { id: string }[];
    };
    assert.equal(raw.tasks.some((t) => t.id === created.id), true);

    const b = createMemoryEscrow(() => 1_700_000_001 as UnixSecs, {
      persistPath: path,
    });
    const got = await b.get(created.id);
    assert.equal(got.id, created.id);
    assert.equal(got.title, "Persist me");
    assert.equal(got.rewardWei, 50_000_000n);
    const listed = await b.list({ status: [EscrowStatus.Open] });
    assert.ok(listed.some((t) => t.id === created.id));
  });

  it("blocks cancel while SUBMITTED before deadline", async () => {
    let now = 1_000 as UnixSecs;
    const escrow = createMemoryEscrow(() => now, { persistPath: null });
    const seeded = makeFixtureTask({
      status: EscrowStatus.Submitted,
      verifyDeadline: 2_000 as UnixSecs,
    });
    escrow.seed(seeded);
    await assert.rejects(
      () =>
        escrow.cancel({
          taskId: seeded.id,
          caller: seeded.owner,
        }),
      (err: unknown) => {
        assert.ok(err instanceof RefundRaceError);
        assert.equal(err.reason, "already_submitted");
        return true;
      },
    );
    const events = escrow.drainEvents();
    assert.deepEqual(
      events.map((e) => e.type),
      ["CancelRequested", "RefundAttempted", "RefundLost"],
    );
    now = 2_001 as UnixSecs;
    const cancelled = await escrow.cancel({
      taskId: seeded.id,
      caller: seeded.owner,
    });
    assert.equal(cancelled.status, EscrowStatus.Cancelled);
  });

  it("SLA breach calls potRefund with reward tinybar", async () => {
    let now = 10_000;
    const clock = () => now as UnixSecs;
    const refunds: bigint[] = [];
    const escrow = createMemoryEscrow(clock, {
      persistPath: null,
      potRefund: async ({ amountWei }) => {
        refunds.push(amountWei);
      },
    });
    const owner = "0x1111111111111111111111111111111111111111" as Address;
    const task = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 50_000_000n as Wei,
      verifyWindowSecs: 3600,
      metadataCid: "bafy-sla" as never,
      owner,
      maxWorkSecs: 3600,
      respondSlaSecs: 5,
    });
    await escrow.accept({
      taskId: task.id,
      worker: "0x2222222222222222222222222222222222222222" as Address,
      humanNullifier: "nf-sla-unit",
    });
    now = 10_100;
    await escrow.submit({ taskId: task.id, resultCid: "bafy-ev" as never });
    now = 10_200;
    const swept = await escrow.sweep(task.id);
    assert.equal(swept.status, EscrowStatus.ExpiredSla);
    assert.deepEqual(refunds, [50_000_000n]);
  });
});
