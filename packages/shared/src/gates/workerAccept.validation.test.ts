import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gateWorkerAccept } from "./workerAccept.js";
import { WorldAuthError } from "../worldAuthTypes.js";
import type { ClaimNullifierStore } from "./claimNullifier.js";
import type { HumanPort } from "../ports/index.js";

function memoryStore(initial: Record<string, string>): ClaimNullifierStore {
  const byAccount = new Map(
    Object.entries(initial).map(([k, v]) => [k.trim(), v.trim()]),
  );
  const byClaim = new Map(
    Object.entries(initial).map(([k, v]) => [v.trim().toLowerCase(), k.trim()]),
  );
  return {
    getByAccount(k) {
      return byAccount.get(k.trim()) ?? null;
    },
    getAccountForClaimNullifier(nf) {
      return byClaim.get(nf.trim().toLowerCase()) ?? null;
    },
    bind(i) {
      byAccount.set(i.accountKey.trim(), i.claimNullifier.trim());
      byClaim.set(i.claimNullifier.trim().toLowerCase(), i.accountKey.trim());
      return { ...i, boundAt: Date.now() };
    },
  };
}

describe("gateWorkerAccept validation_error fallback", () => {
  it("accepts when portal rejects stale proof but payload matches bound claim nullifier", async () => {
    const bound = "0xclaim-bound-for-validation";
    const store = memoryStore({ "world-sub-a": bound });
    const human: HumanPort = {
      async requireHuman() {
        throw new WorldAuthError("verify_failed", "validation_error");
      },
      async isBanned() {
        return false;
      },
      async ban() {},
    };

    const result = await gateWorkerAccept(human, {
      proof: {
        protocol_version: "4.0",
        environment: "production",
        action: "proofwork-accept",
        responses: [{ nullifier: bound }],
      },
      accountKey: "world-sub-a",
      claimStore: store,
      environment: "production",
      action: "proofwork-accept",
    });

    assert.equal(result.nullifierHash, bound);
    assert.equal(result.verified, true);
  });
});
