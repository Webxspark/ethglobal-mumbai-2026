import { createArkiv, type ArkivEnv } from "./adapters/arkiv/index.js";
import { createHcsAudit, type HcsEnv, type HcsBundle } from "./adapters/hcs/index.js";
import { createMemoryEscrow, type MemoryEscrow } from "./adapters/memory/escrow.js";
import {
  createMemoryThread,
  type MemoryThread,
} from "./adapters/memory/thread.js";
import {
  createTaskNotifyBus,
  type TaskNotifyBus,
} from "./adapters/notify/bus.js";
import {
  createDiskAttachmentStore,
  type AttachmentStore,
} from "./adapters/attachments/disk.js";
import { createProjector, type Projector } from "./adapters/project.js";
import path from "node:path";
import {
  createX402Gate,
  defaultX402Env,
  type X402Env,
  type X402Gate,
} from "./adapters/x402-hedera/index.js";
import {
  createAccountBook,
  type AccountBook,
} from "./adapters/accounts/store.js";
import { applyOrphanPostRefunds } from "./adapters/repairs/orphan-post-refund.js";
import {
  createConnectTokenStore,
  type ConnectTokenStore,
} from "./adapters/connect/tokens.js";
import {
  createDeviceAuthStore,
  type DeviceAuthStore,
} from "./adapters/connect/device.js";
import type {
  ArkivPort,
  HumanPort,
  PotPort,
  WorldPassPort,
  X402PaymentPort,
} from "./ports/index.js";
import { createWorldAuth } from "./createWorldAuth.js";
import type { UnixSecs } from "./types.js";

export type McpBackendEnv = {
  port: number;
  x402: X402Env;
  hcs: HcsEnv;
  arkiv: ArkivEnv;
};

export type ComposedPorts = {
  escrow: MemoryEscrow;
  thread: MemoryThread;
  pot: PotPort;
  /** Nullifier → pot registry (also implements PotPort). */
  accounts: AccountBook;
  worldPass: WorldPassPort;
  human: HumanPort;
  arkiv: ArkivPort;
  hcs: HcsBundle;
  x402: X402Gate & X402PaymentPort;
  projector: Projector;
  notify: TaskNotifyBus;
  /** Disk (or later S3) attachment bytes for thread chat. */
  attachments: AttachmentStore;
  /** Short-lived proofwork_connect tokens. */
  connect: ConnectTokenStore;
  /** OAuth-like device authorize for agent onboarding. */
  device: DeviceAuthStore;
  clock: () => UnixSecs;
  /** Interval handle for claim/deadline sweeper — clear on shutdown if needed. */
  sweeper: { stop(): void };
  health: {
    backends: {
      x402: "live";
      hcs: "live";
      arkiv: "live";
      world: "live";
    };
  };
};

function requireEnv(
  env: Record<string, string | undefined>,
  keys: string[],
  label: string,
): void {
  const missing = keys.filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new Error(
      `proofwork boot: ${label} missing required env: ${missing.join(", ")}`,
    );
  }
}

/** Live-only MCP env. Missing sponsor keys fail loudly — no mock fallback. */
export function loadMcpEnv(
  env: Record<string, string | undefined> = process.env,
): McpBackendEnv {
  const port = Number(env.MCP_PORT ?? 38472);

  requireEnv(
    env,
    ["X402_PAY_TO", "X402_FACILITATOR_URL"],
    "Hedera x402",
  );
  requireEnv(
    env,
    ["HEDERA_HCS_TOPIC_ID", "HEDERA_OPERATOR_ID", "HEDERA_OPERATOR_KEY"],
    "Hedera HCS",
  );
  requireEnv(env, ["ARKIV_RPC_URL", "ARKIV_PRIVATE_KEY"], "Arkiv");
  requireEnv(
    env,
    [
      "WORLD_AGENT_PASS_CLIENT_ID",
      "WORLD_AGENT_PASS_CLIENT_SECRET",
      "WORLD_IDKIT_APP_ID",
      "WORLD_IDKIT_RP_ID",
      "WORLD_IDKIT_RP_SIGNING_KEY",
    ],
    "World auth",
  );

  return {
    port,
    x402: defaultX402Env({
      port,
      payTo: env.X402_PAY_TO,
      facilitatorUrl: env.X402_FACILITATOR_URL,
      asset: env.X402_ASSET,
      priceBaseUnits: env.X402_PRICE_BASE_UNITS,
    }),
    hcs: {
      topicId: env.HEDERA_HCS_TOPIC_ID!,
      operatorId: env.HEDERA_OPERATOR_ID!,
      operatorKey: env.HEDERA_OPERATOR_KEY!,
      network: env.HEDERA_NETWORK ?? "testnet",
    },
    arkiv: {
      rpcUrl: env.ARKIV_RPC_URL!,
      privateKey: env.ARKIV_PRIVATE_KEY,
    },
  };
}

export type CreatePortsOptions = {
  onChainRefund?: (taskId: import("./types.js").TaskId) => void | Promise<void>;
};

export function createPorts(
  env: McpBackendEnv,
  processEnv: NodeJS.Dict<string> = process.env,
  opts: CreatePortsOptions = {},
): ComposedPorts {
  const clock = () => Math.floor(Date.now() / 1000) as UnixSecs;
  const accounts = createAccountBook(clock);
  const pot: PotPort = accounts;
  const escrow = createMemoryEscrow(clock, {
    onChainRefund: opts?.onChainRefund,
    potRefund: async ({ potId, amountWei, owner }) => {
      await pot.refundEncumbered({ potId, amountWei, owner });
    },
  });
  const thread = createMemoryThread(clock);
  const hcs = createHcsAudit(env.hcs);
  const arkiv = createArkiv(env.arkiv, clock);
  const projector = createProjector({ hcs, arkiv });
  const x402 = createX402Gate(env.x402);
  void applyOrphanPostRefunds(accounts).catch((err) => {
    console.warn(
      "[repair] orphan refund boot failed:",
      err instanceof Error ? err.message : err,
    );
  });
  const notify = createTaskNotifyBus();
  const connect = createConnectTokenStore(clock);
  const device = createDeviceAuthStore({ clock, tokens: connect });
  const worldAuth = createWorldAuth(processEnv);
  const attachRoot =
    processEnv.PROOFWORK_ATTACHMENTS_DIR?.trim() ||
    path.join(process.cwd(), ".data", "attachments");
  const attachments = createDiskAttachmentStore(attachRoot);

  const sweepMs = Number(processEnv.PROOFWORK_SWEEP_MS ?? 5_000) || 5_000;
  const sweepTimer = setInterval(() => {
    void escrow.sweepAll().catch((err) => {
      console.warn(
        "[sweep]",
        err instanceof Error ? err.message : String(err),
      );
    });
  }, Math.max(1_000, sweepMs));
  sweepTimer.unref?.();

  return {
    escrow,
    thread,
    pot,
    accounts,
    worldPass: worldAuth.world,
    human: worldAuth.human,
    arkiv,
    hcs,
    x402,
    projector,
    notify,
    attachments,
    connect,
    device,
    clock,
    sweeper: {
      stop() {
        clearInterval(sweepTimer);
      },
    },
    health: {
      backends: {
        x402: "live",
        hcs: "live",
        arkiv: "live",
        world: "live",
      },
    },
  };
}

export {
  createX402Gate,
  createHcsAudit,
  createArkiv,
  createMemoryEscrow,
  createMemoryThread,
  createProjector,
  createTaskNotifyBus,
};

export {
  REQUEST_HEADER,
  RESPONSE_HEADER,
  buildRequirements,
  serializeChallenge,
} from "./adapters/x402-hedera/index.js";

export type { X402Gate, X402Decision, PaidToolName } from "./adapters/x402-hedera/index.js";
export type { HcsBundle, AuditLine } from "./adapters/hcs/index.js";
