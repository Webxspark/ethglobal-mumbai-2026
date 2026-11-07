import type { HumanPort, WorldPassPort } from "./ports/index.js";
import {
  loadWorldAuthConfig,
  type WorldAuthConfig,
} from "./env/worldAuthConfig.js";
import { createLiveHuman } from "./adapters/idkit/liveHuman.js";
import { createLiveWorldPass } from "./adapters/world/liveWorldPass.js";
import {
  ApprovalMemoryStore,
  sharedApprovalStore,
} from "./adapters/world/memoryStore.js";
import { signIdKitRpRequest } from "./adapters/idkit/rpSignature.js";

export type WorldAuthBundle = {
  config: WorldAuthConfig;
  world: WorldPassPort;
  human: HumanPort;
  store: ApprovalMemoryStore;
  /**
   * Mint a fresh RP signature. Pass `null` to omit action (session proofs).
   * Pass a string (or omit) for uniqueness / enrollment signatures.
   */
  signRpRequest: (
    action?: string | null,
  ) => ReturnType<typeof signIdKitRpRequest>;
};

/** Composition root for world-auth — always live Continuity + IDKit. */
export function createWorldAuth(
  env: NodeJS.Dict<string> = process.env,
  opts?: {
    store?: ApprovalMemoryStore;
    fetchImpl?: typeof fetch;
  },
): WorldAuthBundle {
  const config = loadWorldAuthConfig(env);
  const store = opts?.store ?? sharedApprovalStore;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  return {
    config,
    world: createLiveWorldPass(config, store, fetchImpl),
    human: createLiveHuman(config, fetchImpl),
    store,
    signRpRequest: (action?: string | null) =>
      signIdKitRpRequest({ cfg: config, action }),
  };
}
