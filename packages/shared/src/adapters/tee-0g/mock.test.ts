import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMockTee } from "./mock.js";
import {
  assertValidTeeSig,
  mockTeeSignerAddress,
  verdictDigest,
} from "../../crypto/verdict.js";
import type { TaskId } from "../../types.js";

describe("mock TeeML", () => {
  it("signs with HappyPath 0xA11CE and recovers", async () => {
    const tee = createMockTee();
    const taskId =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as TaskId;
    const verdict = await tee.scoreSubmission({
      taskId,
      payload: { resultCid: "bafy-photo", codeWord: "MUMBAI" },
    });
    assert.equal(verdict.approved, true);
    assert.equal(
      verdict.signer.toLowerCase(),
      mockTeeSignerAddress().toLowerCase(),
    );
    assert.equal(verdict.signature.length, 132); // 0x + 65 bytes

    const recovered = await assertValidTeeSig({
      taskId,
      resultHash: verdict.resultHash,
      approved: true,
      teeSig: verdict.signature,
      expectedSigner: tee.signer,
    });
    assert.equal(recovered.toLowerCase(), tee.signer.toLowerCase());

    const digest = verdictDigest(taskId, verdict.resultHash, true);
    assert.match(digest, /^0x[0-9a-f]{64}$/);
  });

  it("forceReject yields approved=false signature", async () => {
    const tee = createMockTee();
    const taskId =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as TaskId;
    const verdict = await tee.scoreSubmission({
      taskId,
      payload: { resultCid: "bafy-replay", forceReject: true },
    });
    assert.equal(verdict.approved, false);
    await assert.rejects(
      () =>
        assertValidTeeSig({
          taskId,
          resultHash: verdict.resultHash,
          approved: true, // escrow always checks approved=true digest
          teeSig: verdict.signature,
          expectedSigner: tee.signer,
        }),
      /BadTeeSignature/,
    );
  });
});
