/**
 * Test/fixture helpers only. Not wired into live compose.
 */
import {
  EscrowStatus,
  type Address,
  type EscrowTask,
  type PotId,
  type Wei,
} from "../types.js";

const fixturePotId =
  "0xa11ce00000000000000000000000000000000001" as PotId;
const fixtureOwner =
  "0x0000000000000000000000000000000000000a11" as Address;

/** Build an EscrowTask for unit tests (memory escrow / arkiv doubles). */
export function makeFixtureTask(overrides: Partial<EscrowTask> = {}): EscrowTask {
  const id =
    (overrides.id as EscrowTask["id"] | undefined) ??
    ("0xtask000000000000000000000000000000000001" as EscrowTask["id"]);
  return {
    id,
    potId: fixturePotId,
    rewardWei: 50_000_000n as Wei,
    status: EscrowStatus.Open,
    owner: fixtureOwner,
    worker: null,
    humanNullifier: null,
    resultCid: null,
    teeVerdictHash: null,
    verifyDeadline: null,
    metadataCid: "bafy-fixture" as EscrowTask["metadataCid"],
    geo: { lat: 19.076, lng: 72.877 },
    createdAt: Math.floor(Date.now() / 1000) as EscrowTask["createdAt"],
    deadlineAt: null,
    expiresAt: null,
    maxWorkSecs: null,
    claimExpiresAt: null,
    claimedAt: null,
    blockedWorkers: [],
    respondSlaSecs: null,
    respondDeadline: null,
    notifyUrl: null,
    category: null,
    tags: [],
    title: null,
    posterAgent: null,
    submittedAt: null,
    ...overrides,
  };
}
