/**
 * Test-only composition. Import from `@proofwork/shared/compose-test`.
 * Throws unless NODE_ENV=test — never used by live MCP/web boot.
 */
import { createMockArkiv } from "./adapters/arkiv/mock.js";
import { createMockHcs } from "./adapters/hcs/mock.js";
import { createMemoryEscrow } from "./adapters/memory/escrow.js";
import { createMemoryThread } from "./adapters/memory/thread.js";
import { createTaskNotifyBus } from "./adapters/notify/bus.js";
import { createDiskAttachmentStore } from "./adapters/attachments/disk.js";
import { createProjector } from "./adapters/project.js";
import { createMockX402Gate, mockRequirePayment } from "./adapters/x402-hedera/mock.js";
import { defaultX402Env } from "./adapters/x402-hedera/index.js";
import { createAccountBook } from "./adapters/accounts/store.js";
import { createConnectTokenStore } from "./adapters/connect/tokens.js";
import { createDeviceAuthStore } from "./adapters/connect/device.js";
import { createStubHuman } from "./adapters/idkit/stubHuman.js";
import { createStubWorldPass } from "./adapters/world/stubWorldPass.js";
import { loadWorldAuthConfig } from "./env/worldAuthConfig.js";
import { ApprovalMemoryStore } from "./adapters/world/memoryStore.js";
import path from "node:path";
import type { ComposedPorts } from "./compose.js";
import type { UnixSecs } from "./types.js";
import type { PotPort, X402PaymentPort } from "./ports/index.js";
import type { X402Gate } from "./adapters/x402-hedera/types.js";

function assertTestEnv(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "createTestPorts is only available when NODE_ENV=test",
    );
  }
}

export function createTestPorts(
  processEnv: NodeJS.Dict<string> = process.env,
): ComposedPorts {
  assertTestEnv();

  const clock = () => Math.floor(Date.now() / 1000) as UnixSecs;
  // Default off-disk; tests that set PROOFWORK_*_PATH keep persistence.
  const accountsPath =
    processEnv.PROOFWORK_ACCOUNTS_PATH === undefined
      ? null
      : processEnv.PROOFWORK_ACCOUNTS_PATH === "off"
        ? null
        : processEnv.PROOFWORK_ACCOUNTS_PATH;
  const escrowPath =
    processEnv.PROOFWORK_ESCROW_PATH === undefined
      ? null
      : processEnv.PROOFWORK_ESCROW_PATH === "off"
        ? null
        : processEnv.PROOFWORK_ESCROW_PATH;
  const tokensPath =
    processEnv.PROOFWORK_CONNECT_TOKENS_PATH === undefined
      ? null
      : processEnv.PROOFWORK_CONNECT_TOKENS_PATH === "off"
        ? null
        : processEnv.PROOFWORK_CONNECT_TOKENS_PATH;

  const accounts = createAccountBook(clock, { persistPath: accountsPath });
  const pot: PotPort = accounts;

  const escrow = createMemoryEscrow(clock, {
    persistPath: escrowPath,
    potRefund: async (i) => {
      await pot.refundEncumbered(i);
    },
  });
  const thread = createMemoryThread(clock);
  const hcs = createMockHcs();
  const arkiv = createMockArkiv(clock);
  const projector = createProjector({ hcs, arkiv });
  const x402Env = defaultX402Env({
    port: Number(processEnv.MCP_PORT ?? 38472),
    payTo: processEnv.X402_PAY_TO ?? "0.0.8000001",
    facilitatorUrl:
      processEnv.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
  });
  const gate = createMockX402Gate(x402Env);
  const x402 = {
    ...gate,
    requirePayment: mockRequirePayment,
  } as X402Gate & X402PaymentPort;

  const notify = createTaskNotifyBus();
  const connect = createConnectTokenStore(clock, {
    persistPath: tokensPath,
  });
  const device = createDeviceAuthStore({ clock, tokens: connect });

  // Stub World/IDKit doubles — injected here, not via WORLD_AUTH_MODE.
  const cfg = loadWorldAuthConfig({
    ...processEnv,
    WORLD_AGENT_PASS_CLIENT_ID:
      processEnv.WORLD_AGENT_PASS_CLIENT_ID ?? "test-agent-pass",
    WORLD_AGENT_PASS_CLIENT_SECRET:
      processEnv.WORLD_AGENT_PASS_CLIENT_SECRET ?? "test-secret",
    WORLD_IDKIT_APP_ID: processEnv.WORLD_IDKIT_APP_ID ?? "app_test",
    WORLD_IDKIT_RP_ID: processEnv.WORLD_IDKIT_RP_ID ?? "rp_test",
    WORLD_IDKIT_RP_SIGNING_KEY:
      processEnv.WORLD_IDKIT_RP_SIGNING_KEY ?? "00".repeat(32),
    PROOFWORK_PUBLIC_URL:
      processEnv.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471",
  });
  const store = new ApprovalMemoryStore();
  const worldPass = createStubWorldPass(cfg, store);
  const human = createStubHuman(cfg);

  const attachRoot =
    processEnv.PROOFWORK_ATTACHMENTS_DIR?.trim() ||
    path.join(process.cwd(), ".data", "attachments-test");
  const attachments = createDiskAttachmentStore(attachRoot);

  return {
    escrow,
    thread,
    pot,
    accounts,
    worldPass,
    human,
    arkiv,
    hcs,
    x402,
    projector,
    notify,
    attachments,
    connect,
    device,
    clock,
    sweeper: { stop() {} },
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
