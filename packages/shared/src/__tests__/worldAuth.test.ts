import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  ApprovalMemoryStore,
  WorldAuthError,
  createWorldAuth,
  gateCompleteApproval,
  gateRequestApproval,
  gateWorkerAccept,
  loadWorldAuthConfig,
  type Address,
  type PotId,
  type TaskId,
  type Wei,
} from "../index.js";
import { createStubWorldPass } from "../adapters/world/stubWorldPass.js";
import {
  clearStubHumanBans,
  createStubHuman,
} from "../adapters/idkit/stubHuman.js";
import { TEST_WORLD_KEYS } from "./testWorldKeys.js";

const owner = "0x0000000000000000000000000000000000000a11" as Address;
const potId = "0xa11ce00000000000000000000000000000000001" as PotId;
const taskId = "0xtask000000000000000000000000000000000099" as TaskId;

function stubBundle(store: ApprovalMemoryStore) {
  const cfg = loadWorldAuthConfig(TEST_WORLD_KEYS);
  return {
    config: cfg,
    world: createStubWorldPass(cfg, store),
    human: createStubHuman(cfg),
  };
}

describe("world-auth Agent Pass approval (stub doubles)", () => {
  const store = new ApprovalMemoryStore();

  beforeEach(() => {
    store.clear();
  });

  it("begin → complete stub Continuity flow grants approval", async () => {
    const auth = stubBundle(store);

    const pending = await gateRequestApproval(auth.world, {
      taskId,
      potId,
      amountWei: 200_000_000n as Wei,
      owner,
      reason: "over threshold shelf check",
      redirectUri: "http://127.0.0.1:38471/api/world/approve/callback",
      thresholdWei: 100_000_000n as Wei,
    });

    assert.equal(pending.required, true);
    if (!pending.required) return;

    const url = new URL(pending.authorizeUrl);
    const code = url.searchParams.get("code")!;
    const state = url.searchParams.get("state")!;

    const done = await gateCompleteApproval(auth.world, {
      approvalId: pending.approvalId,
      code,
      state,
    });
    assert.ok(done.identity.sub);
    const record = await auth.world.getApproval(pending.approvalId);
    assert.equal(record.status, "approved");
  });

  it("skips gate when below threshold", async () => {
    const auth = stubBundle(store);
    const result = await gateRequestApproval(auth.world, {
      taskId,
      potId,
      amountWei: 100n as Wei,
      owner,
      reason: "small",
      redirectUri: "http://127.0.0.1:38471/cb",
      thresholdWei: 1_000n as Wei,
    });
    assert.equal(result.required, false);
  });

  it("deny path: approval_denied", async () => {
    const auth = stubBundle(store);
    const pending = await auth.world.beginOwnerApproval({
      taskId,
      potId,
      amountWei: 2n as Wei,
      owner,
      reason: "test",
      redirectUri: "http://127.0.0.1:38471/cb",
    });
    const deniedRec = await auth.world.getApproval(pending.approvalId);
    await assert.rejects(
      () =>
        auth.world.completeOwnerApproval({
          approvalId: pending.approvalId,
          code: `stub-code:${pending.approvalId}:deny`,
          state: deniedRec.authAttempt!.state,
        }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "approval_denied",
    );
  });

  it("deny path: not_owner", async () => {
    const auth = stubBundle(store);
    const pending = await auth.world.beginOwnerApproval({
      taskId,
      potId,
      amountWei: 2n as Wei,
      owner,
      reason: "test",
      redirectUri: "http://127.0.0.1:38471/cb",
      expectedOwner: { iss: "https://auth.world.org", sub: "real-owner" },
    });
    const rec = await auth.world.getApproval(pending.approvalId);
    await assert.rejects(
      () =>
        auth.world.completeOwnerApproval({
          approvalId: pending.approvalId,
          code: `stub-code:${pending.approvalId}:wrong-owner`,
          state: rec.authAttempt!.state,
        }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "not_owner",
    );
  });

  it("deny path: approval_expired", async () => {
    const auth = stubBundle(store);
    const pending = await auth.world.beginOwnerApproval({
      taskId,
      potId,
      amountWei: 2n as Wei,
      owner,
      reason: "test",
      redirectUri: "http://127.0.0.1:38471/cb",
      ttlSecs: 0,
    });
    store.update(pending.approvalId, {
      expiresAt: (Math.floor(Date.now() / 1000) - 1) as never,
    });
    const rec = await auth.world.getApproval(pending.approvalId);
    assert.equal(rec.status, "expired");
    await assert.rejects(
      () =>
        auth.world.completeOwnerApproval({
          approvalId: pending.approvalId,
          code: `stub-code:${pending.approvalId}`,
          state: rec.authAttempt!.state,
        }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "approval_expired",
    );
  });

  it("assertAgentPass accepts stub attestation", async () => {
    const auth = stubBundle(store);
    const result = await auth.world.assertAgentPass({
      owner,
      amountWei: 2n as Wei,
      attestation: "stub:priya",
    });
    assert.equal(result.identity.sub, "priya");
  });
});

describe("world-auth IDKit Proof of Human", () => {
  beforeEach(() => {
    clearStubHumanBans();
  });

  it("gateWorkerAccept returns nullifier from stub proof", async () => {
    const auth = stubBundle(new ApprovalMemoryStore());
    const human = await gateWorkerAccept(auth.human, {
      proof: {
        protocol_version: "4.0",
        action: "proofwork-accept",
        environment: "staging",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier:
              "0x2bf8406809dcefb1486dadc96c0a897db9bab002053054cf64272db512c6fbd8",
            issuer_schema_id: 1,
          },
        ],
      },
      signal: "0xworker",
    });
    assert.match(human.nullifierHash, /^0x/);
    assert.equal(human.verified, true);
  });

  it("banned nullifier blocks accept", async () => {
    const auth = stubBundle(new ApprovalMemoryStore());
    const nullifier =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await auth.human.ban(nullifier, "sybil");
    await assert.rejects(
      () =>
        gateWorkerAccept(auth.human, {
          proof: {
            environment: "stub",
            responses: [{ nullifier }],
          },
        }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "banned_nullifier",
    );
  });

  it("cancelled proof does not accept", async () => {
    const auth = stubBundle(new ApprovalMemoryStore());
    await assert.rejects(
      () => gateWorkerAccept(auth.human, { proof: { cancelled: true } }),
      (err: unknown) =>
        err instanceof WorldAuthError && err.code === "cancelled",
    );
  });

  it("live human treats validation_error as verified when proof nullifier matches bound hint", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "validation_error",
          detail: "proof already consumed",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    const auth = createWorldAuth(
      {
        ...TEST_WORLD_KEYS,
        WORLD_IDKIT_ENVIRONMENT: "production",
      },
      { fetchImpl },
    );

    const bound = "0xboundclaimnullifier";
    const result = await gateWorkerAccept(auth.human, {
      proof: {
        protocol_version: "4.0",
        action: "proofwork-accept",
        environment: "production",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier: bound,
            issuer_schema_id: 1,
          },
        ],
      },
      nullifierHash: bound,
    });
    assert.equal(result.nullifierHash, bound);
    assert.equal(result.verified, true);
  });

  it("live human treats nullifier_replayed as already verified", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          code: "nullifier_replayed",
          nullifier: "0xalreadyhuman",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );

    const auth = createWorldAuth(
      {
        ...TEST_WORLD_KEYS,
        WORLD_IDKIT_ENVIRONMENT: "production",
      },
      { fetchImpl },
    );

    const result = await gateWorkerAccept(auth.human, {
      proof: {
        protocol_version: "4.0",
        action: "proofwork-accept",
        environment: "production",
        responses: [
          {
            identifier: "proof_of_human",
            nullifier: "0xalreadyhuman",
            issuer_schema_id: 1,
          },
        ],
      },
    });
    assert.equal(result.nullifierHash, "0xalreadyhuman");
    assert.equal(result.verified, true);
  });

  it("live human forwards payload to verify endpoint", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(
        JSON.stringify({
          success: true,
          environment: "staging",
          nullifier: "0xlivenullifier",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const auth = createWorldAuth(
      {
        ...TEST_WORLD_KEYS,
        WORLD_IDKIT_ENVIRONMENT: "staging",
      },
      { fetchImpl },
    );

    const proof = {
      protocol_version: "4.0",
      nonce: "0xabc123",
      environment: "staging",
      action: "proofwork-accept",
      integrity_bundle: {
        version: 2,
        signature_format: "apple_app_attest",
        timestamp: 1_788_302_923,
        signature: "a1b2c3d4",
        jwt: "eyJ...",
      },
      responses: [
        {
          identifier: "proof_of_human",
          nullifier: "0xlivenullifier",
          issuer_schema_id: 1,
        },
      ],
    };

    const result = await gateWorkerAccept(auth.human, {
      proof,
      signal: "should-not-appear",
      action: "also-not-merged",
    });

    assert.equal(result.nullifierHash, "0xlivenullifier");
    assert.ok(calls[0]?.url.endsWith("/rp_test"));
    assert.deepEqual(calls[0]?.body, proof);
    assert.equal(
      (calls[0]?.body as { environment: string }).environment,
      "staging",
    );
    assert.equal("signal" in (calls[0]?.body as object), false);
  });
});
