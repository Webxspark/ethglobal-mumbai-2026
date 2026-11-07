import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryEscrow } from "./escrow.js";
import { createMemoryThread } from "./thread.js";
import { createMockTee } from "../tee-0g/mock.js";
import { createMockArkiv } from "../arkiv/mock.js";
import { createMockHcs } from "../hcs/mock.js";
import { createProjector } from "../project.js";
import { makeFixtureTask } from "../stubs.js";
import {
  EscrowStatus,
  type Address,
  type Cid,
  type UnixSecs,
  type Wei,
} from "../../types.js";

describe("submit → thread → allSatisfied → PAID", () => {
  it("happy path with HCS audit + Arkiv feed refresh", async () => {
    let now = 1_700_000_000 as UnixSecs;
    const clock = () => now;
    const tee = createMockTee();
    const escrow = createMemoryEscrow(clock, { teeSigner: tee.signer });
    const thread = createMemoryThread(clock);
    const hcs = createMockHcs();
    const arkiv = createMockArkiv(clock);
    const projector = createProjector({ hcs, arkiv });

    const owner =
      "0x1111111111111111111111111111111111111111" as Address;
    const worker =
      "0x2222222222222222222222222222222222222222" as Address;

    const created = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 50_000_000n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy-shelf-check" as Cid,
      geo: { lat: 19.076, lng: 72.877 },
      owner,
    });
    await projector.project(created, escrow.drainEvents());
    assert.equal(arkiv.snapshot().length, 1);
    assert.equal(arkiv.snapshot()[0]?.taskId, created.id);

    const accepted = await escrow.accept({
      taskId: created.id,
      worker,
      humanNullifier: "nullifier-demo",
    });
    await projector.project(accepted, escrow.drainEvents());
    assert.equal(arkiv.snapshot().length, 1);

    const resultCid = "bafy-photo-codeword" as Cid;
    // TeeML still scores — but only as review input for the agent.
    const verdict = await tee.scoreSubmission({
      taskId: created.id,
      payload: { resultCid, codeWord: "MUMBAI" },
    });
    assert.equal(verdict.approved, true);

    const submitted = await escrow.submit({
      taskId: created.id,
      resultCid,
      teeVerdict: verdict,
    });
    assert.equal(submitted.status, EscrowStatus.Submitted);
    await thread.post({
      taskId: created.id,
      role: "worker",
      body: "Shelf photo + code word attached",
      attachmentCid: resultCid,
      kind: "evidence",
    });
    await projector.project(submitted, escrow.drainEvents());
    assert.equal(arkiv.snapshot().length, 1);

    const near = await arkiv.nearby({
      lat: 19.076,
      lng: 72.877,
      radiusM: 5000,
    });
    assert.deepEqual(near, [created.id]);

    // Old TeeML-only verify path must not pay.
    await assert.rejects(
      () =>
        escrow.verify({
          taskId: created.id,
          owner,
          teeSig: verdict.signature,
        }),
      /TeePathDemoted/,
    );

    const msgs = await thread.list(created.id);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]?.kind, "evidence");

    const paid = await escrow.allSatisfied({
      taskId: created.id,
      owner,
      note: "looks good — shelf matches brief",
    });
    assert.equal(paid.status, EscrowStatus.Paid);
    await projector.project(paid, escrow.drainEvents());

    assert.deepEqual(
      await arkiv.nearby({ lat: 19.076, lng: 72.877, radiusM: 5000 }),
      [],
    );

    const audit = await hcs.readRecent(20);
    const types = audit.map((l) => l.event.type);
    assert.deepEqual(types, [
      "TaskPosted",
      "TaskAccepted",
      "TaskSubmitted",
      "AgentSatisfied",
      "Paid",
    ]);
  });

  it("dispute after evidence → OPEN (worker unassigned)", async () => {
    const escrow = createMemoryEscrow();
    const owner =
      "0x1111111111111111111111111111111111111111" as Address;
    const worker =
      "0x2222222222222222222222222222222222222222" as Address;
    const created = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 1n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy" as Cid,
      owner,
    });
    await escrow.accept({
      taskId: created.id,
      worker,
      humanNullifier: "n",
    });
    await escrow.submit({
      taskId: created.id,
      resultCid: "bafy-x" as Cid,
    });
    const hit = await escrow.dispute({
      taskId: created.id,
      owner,
      reason: "photo blurry / code word missing",
    });
    assert.equal(hit.status, EscrowStatus.Open);
    assert.equal(hit.worker, null);
    assert.ok(hit.blockedWorkers?.includes(worker));
    assert.match(hit.disputeReason ?? "", /blurry/);
    const ev = escrow.drainEvents().map((e) => e.type);
    assert.ok(ev.includes("TaskDisputed"));
  });

  it("requestChanges SUBMITTED → ACCEPTED clears evidence", async () => {
    const escrow = createMemoryEscrow();
    const owner =
      "0x1111111111111111111111111111111111111111" as Address;
    const worker =
      "0x2222222222222222222222222222222222222222" as Address;
    const created = await escrow.createTask({
      potId: makeFixtureTask().potId,
      rewardWei: 1n as Wei,
      verifyWindowSecs: 900,
      metadataCid: "bafy" as Cid,
      owner,
      maxWorkSecs: 600,
    });
    await escrow.accept({
      taskId: created.id,
      worker,
      humanNullifier: "n",
    });
    await escrow.submit({
      taskId: created.id,
      resultCid: "bafy-x" as Cid,
    });
    const back = await escrow.requestChanges({
      taskId: created.id,
      owner,
      note: "retake shelf photo",
    });
    assert.equal(back.status, EscrowStatus.Accepted);
    assert.equal(back.resultCid, null);
    assert.ok(back.claimExpiresAt);
  });

  it("resolveDispute release from DISPUTED → SUBMITTED", async () => {
    const escrow = createMemoryEscrow(undefined, { persistPath: null });
    const owner =
      "0x1111111111111111111111111111111111111111" as Address;
    const worker =
      "0x2222222222222222222222222222222222222222" as Address;
    const legacy = makeFixtureTask({
      status: EscrowStatus.Disputed,
      owner,
      worker,
      humanNullifier: "n",
      resultCid: "bafy-fixed" as Cid,
    });
    escrow.seed(legacy);
    const ready = await escrow.resolveDispute({
      taskId: legacy.id,
      owner,
      outcome: "release",
      resultCid: "bafy-fixed" as Cid,
    });
    assert.equal(ready.status, EscrowStatus.Submitted);
    assert.equal(ready.resultCid, "bafy-fixed");
  });
});
