import type { TeePort } from "../../ports/index.js";
import type { Address } from "../../types.js";
import { MOCK_TEE_PRIVATE_KEY, mockTeeSignerAddress } from "../../crypto/verdict.js";
import { createLiveTee, type LiveTeeConfig } from "./live.js";
import { createMockTee, type MockTeeOptions } from "./mock.js";
import type { Hex } from "viem";

export { createMockTee, createLiveTee };
export type { MockTeeOptions, LiveTeeConfig };

export type TeeEnv = {
  mode: "mock" | "live";
  endpoint?: string;
  apiKey?: string;
  fallbackPrivateKey?: Hex;
  mockPrivateKey?: Hex;
};

export type TeeBundle = TeePort & {
  mode: "mock" | "live";
  signer: Address;
};

export function createTee(env: TeeEnv, opts?: MockTeeOptions): TeeBundle {
  if (env.mode === "live") {
    if (!env.endpoint) {
      throw new Error("PROOFWORK_TEE_MODE=live requires OG_TEEML_URL");
    }
    const port = createLiveTee({
      endpoint: env.endpoint,
      apiKey: env.apiKey,
      fallbackPrivateKey:
        env.fallbackPrivateKey ?? (MOCK_TEE_PRIVATE_KEY as Hex),
    });
    return {
      mode: "live",
      signer: mockTeeSignerAddress(),
      scoreSubmission: port.scoreSubmission.bind(port),
    };
  }

  const mock = createMockTee({
    privateKey: env.mockPrivateKey,
    ...opts,
  });
  return {
    mode: "mock",
    signer: mock.signer,
    scoreSubmission: mock.scoreSubmission.bind(mock),
  };
}
