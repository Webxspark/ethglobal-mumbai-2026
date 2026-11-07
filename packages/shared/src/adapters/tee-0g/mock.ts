import { createHash, randomBytes } from "node:crypto";
import type { TeePort } from "../../ports/index.js";
import type { Address, Cid, SignedTeeVerdict, TaskId } from "../../types.js";
import {
  MOCK_TEE_PRIVATE_KEY,
  mockTeeSignerAddress,
  signVerdict,
} from "../../crypto/verdict.js";
import type { Hex } from "viem";

export type MockTeeOptions = {
  /** Override private key (defaults to Foundry HappyPath 0xA11CE). */
  privateKey?: Hex;
  /** Force approve/reject; default: approve unless payload.forceReject. */
  decide?: (payload: unknown) => boolean;
};

function resultHashFromPayload(taskId: TaskId, payload: unknown): `0x${string}` {
  const cid =
    payload &&
    typeof payload === "object" &&
    "resultCid" in payload &&
    typeof (payload as { resultCid?: unknown }).resultCid === "string"
      ? ((payload as { resultCid: string }).resultCid as Cid)
      : ("bafy-empty" as Cid);
  const digest = createHash("sha256")
    .update(`${taskId}:${cid}`)
    .digest("hex");
  return (`0x${digest}`) as `0x${string}`;
}

/**
 * Mock 0G TeeML — produces EIP-191 signed verdicts with the same key as
 * packages/contracts/test/HappyPath.t.sol (TEE_PK = 0xA11CE).
 */
export function createMockTee(opts: MockTeeOptions = {}): TeePort & {
  signer: Address;
} {
  const privateKey = (opts.privateKey ?? MOCK_TEE_PRIVATE_KEY) as Hex;
  const signer = mockTeeSignerAddress();

  return {
    signer,

    async scoreSubmission({ taskId, payload }): Promise<SignedTeeVerdict> {
      const forceReject =
        payload &&
        typeof payload === "object" &&
        (payload as { forceReject?: boolean }).forceReject === true;
      const approved = opts.decide
        ? opts.decide(payload)
        : !forceReject;

      const resultHash =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { resultHash?: unknown }).resultHash === "string"
          ? ((payload as { resultHash: `0x${string}` }).resultHash)
          : resultHashFromPayload(taskId, payload);

      const signed = await signVerdict({
        taskId,
        resultHash,
        approved,
        privateKey,
      });

      return {
        taskId,
        resultHash,
        approved,
        signer: signed.signer,
        signature: signed.signature,
        requestId: `mock-0g-${randomBytes(6).toString("hex")}`,
      };
    },
  };
}
