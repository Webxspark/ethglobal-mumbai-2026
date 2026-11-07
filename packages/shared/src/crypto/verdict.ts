/**
 * TS mirror of packages/contracts ITeeVerifier / Escrow.verdictDigest + recoverTeeSigner.
 *
 * Solidity:
 *   inner  = keccak256(abi.encode(taskId, resultHash, approved))
 *   digest = keccak256("\x19Ethereum Signed Message:\n32" ‖ inner)
 */
import {
  encodeAbiParameters,
  hashMessage,
  hexToBytes,
  keccak256,
  recoverAddress,
  serializeSignature,
  type Hex,
} from "viem";
import { privateKeyToAccount, sign } from "viem/accounts";
import type { Address, TaskId } from "../types.js";

/** Foundry HappyPath.t.sol TEE_PK — mock TeeML signer. */
export const MOCK_TEE_PRIVATE_KEY =
  "0x00000000000000000000000000000000000000000000000000000000000a11ce" as const;

export function mockTeeSignerAddress(): Address {
  return privateKeyToAccount(MOCK_TEE_PRIVATE_KEY).address as Address;
}

/**
 * Pad/truncate a 0x hex id to bytes32 for abi.encode parity with Solidity.
 * Non-hex demo labels (legacy `0xtask…` fixtures) are hashed to bytes32.
 */
export function asBytes32(hex: string): Hex {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (/^[0-9a-fA-F]+$/.test(raw)) {
    if (raw.length > 64) {
      return (`0x${raw.slice(0, 64)}`) as Hex;
    }
    return (`0x${raw.padStart(64, "0")}`) as Hex;
  }
  return keccak256(Buffer.from(hex, "utf8") as never);
}

export function verdictInnerHash(
  taskId: TaskId | string,
  resultHash: `0x${string}`,
  approved: boolean,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: "taskId", type: "bytes32" },
        { name: "resultHash", type: "bytes32" },
        { name: "approved", type: "bool" },
      ],
      [asBytes32(taskId), asBytes32(resultHash), approved],
    ),
  );
}

/** EIP-191 personal_sign digest over the 32-byte inner hash (Solidity verdictDigest). */
export function verdictDigest(
  taskId: TaskId | string,
  resultHash: `0x${string}`,
  approved: boolean,
): Hex {
  const inner = verdictInnerHash(taskId, resultHash, approved);
  return hashMessage({ raw: inner });
}

export async function signVerdict(i: {
  taskId: TaskId | string;
  resultHash: `0x${string}`;
  approved: boolean;
  privateKey?: Hex;
}): Promise<{ digest: Hex; signature: Hex; signer: Address }> {
  const privateKey = (i.privateKey ?? MOCK_TEE_PRIVATE_KEY) as Hex;
  const account = privateKeyToAccount(privateKey);
  const digest = verdictDigest(i.taskId, i.resultHash, i.approved);
  // sign({ hash }) signs the pre-hashed EIP-191 digest without hashing again.
  const sig = await sign({ hash: digest, privateKey });
  const signature = serializeSignature(sig);
  return {
    digest,
    signature,
    signer: account.address as Address,
  };
}

export async function recoverTeeSigner(
  digest: Hex,
  teeSig: `0x${string}`,
): Promise<Address | null> {
  try {
    if (hexToBytes(teeSig as Hex).length !== 65) return null;
    const recovered = await recoverAddress({
      hash: digest,
      signature: teeSig as Hex,
    });
    return recovered as Address;
  } catch {
    return null;
  }
}

export async function assertValidTeeSig(i: {
  taskId: TaskId | string;
  resultHash: `0x${string}`;
  approved: boolean;
  teeSig: `0x${string}`;
  expectedSigner: Address;
}): Promise<Address> {
  const digest = verdictDigest(i.taskId, i.resultHash, i.approved);
  const recovered = await recoverTeeSigner(digest, i.teeSig);
  if (!recovered || recovered.toLowerCase() !== i.expectedSigner.toLowerCase()) {
    throw new Error("BadTeeSignature");
  }
  return recovered;
}
