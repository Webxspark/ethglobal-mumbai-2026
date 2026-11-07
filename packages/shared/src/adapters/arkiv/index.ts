import type { ArkivPort } from "../../ports/index.js";
import { createLiveArkiv } from "./live.js";
import type { UnixSecs } from "../../types.js";

export type ArkivEnv = {
  rpcUrl: string;
  privateKey?: string;
};

/** Live Arkiv (Rabdi) only — no runtime mock. */
export function createArkiv(
  env: ArkivEnv,
  clock?: () => UnixSecs,
): ArkivPort {
  void clock;
  if (!env.rpcUrl?.trim()) {
    throw new Error("proofwork boot: Arkiv requires ARKIV_RPC_URL");
  }
  return createLiveArkiv({
    rpcUrl: env.rpcUrl,
    privateKey: env.privateKey,
  });
}
