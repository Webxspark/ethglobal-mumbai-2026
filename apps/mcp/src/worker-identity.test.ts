import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  EscrowStatus,
  workerFromNullifier,
  type Address,
  type Cid,
  type PotId,
  type Wei,
} from "@proofwork/shared";
import { createMemoryEscrow } from "@proofwork/shared/compose";
import {
  DEMO_WORKER,
  __resetWorkerProfilesForTests,
  repairDemoWorkerClaims,
  resolvePayoutAddress,
  setWorkerPayout,
} from "./worker-profiles.js";

describe("worker identity — nullifier SoT", () => {
  const dir = mkdtempSync(join(tmpdir(), "pw-worker-id-"));
  const prevProfiles = process.env.PROOFWORK_WORKER_PROFILES_PATH;
  const prevEscrow = process.env.PROOFWORK_ESCROW_PATH;

  before(() => {
    process.env.PROOFWORK_WORKER_PROFILES_PATH = join(dir, "profiles.json");
    process.env.PROOFWORK_ESCROW_PATH = "memory";
    __resetWorkerProfilesForTests();
  });

  after(() => {
    if (prevProfiles === undefined) delete process.env.PROOFWORK_WORKER_PROFILES_PATH;
    else process.env.PROOFWORK_WORKER_PROFILES_PATH = prevProfiles;
    if (prevEscrow === undefined) delete process.env.PROOFWORK_ESCROW_PATH;
    else process.env.PROOFWORK_ESCROW_PATH = prevEscrow;
    rmSync(dir, { recursive: true, force: true });
  });

  it("derives a stable worker address from the session nullifier", () => {
    const a = workerFromNullifier("oidc-sub-alice");
    const b = workerFromNullifier("oidc-sub-alice");
    const c = workerFromNullifier("oidc-sub-bob");
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.notEqual(a, DEMO_WORKER);
  });

  it("rejects demo worker as a payout key", () => {
    assert.throws(
      () =>
        setWorkerPayout(
          DEMO_WORKER,
          "0xd156D30000000000000000000000000000AeCfDB",
        ),
      /demo worker/i,
    );
  });

  it("all_satisfied resolves payout by claimant nullifier after demo rekey", async () => {
    __resetWorkerProfilesForTests();
    const escrow = createMemoryEscrow(() => 1_700_000_000 as never, {
      persistPath: null,
    });
    const potId = "0xp0t000000000000000000000000000000000099" as PotId;
    const owner = "0x0000000000000000000000000000000000000a11" as Address;
    const task = await escrow.createTask({
      potId,
      owner,
      rewardWei: 100_000_000n as Wei,
      metadataCid: "bafy-field-check" as Cid,
      title: "Field check",
    });
    // Legacy bug: claimed as DEMO_WORKER with a stub nullifier.
    await escrow.accept({
      taskId: task.id,
      worker: DEMO_WORKER,
      humanNullifier: "stub-nullifier-22222222",
    });
    await escrow.submit({
      taskId: task.id,
      resultCid: "bafy-evidence" as Cid,
    });

    const sessionNf = "world-session-nullifier-live";
    const payout = "0xd156D31111111111111111111111111111AeCfDB" as const;
    setWorkerPayout(sessionNf, payout);

    const { repaired, worker } = await repairDemoWorkerClaims(escrow, sessionNf);
    assert.ok(repaired.includes(task.id));
    assert.equal(worker, workerFromNullifier(sessionNf));

    const fixed = await escrow.get(task.id);
    assert.equal(fixed.worker, worker);
    assert.equal(fixed.humanNullifier, sessionNf);
    assert.equal(fixed.status, EscrowStatus.Submitted);

    const hit = resolvePayoutAddress({
      humanNullifier: fixed.humanNullifier,
      worker: fixed.worker,
    });
    assert.equal(hit, payout);
  });
});
