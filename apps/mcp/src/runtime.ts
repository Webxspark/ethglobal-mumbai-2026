import { createPorts, loadMcpEnv, type ComposedPorts } from "@proofwork/shared/compose";
import type { TaskId } from "@proofwork/shared";
import { tryBindEnvToken } from "./auth.js";
import { gigEscrowConfigured, refundGigEscrow } from "./onchain-escrow.js";
import { createMemorySession, type ToolSession } from "./session.js";
import { createTools, type Tools } from "./tools.js";

export type McpRuntime = {
  env: ReturnType<typeof loadMcpEnv>;
  ports: ComposedPorts;
  tools: Tools;
  session: ToolSession;
};

/** Shared compose boot used by HTTP server and stdio MCP bridge. */
export async function bootRuntime(
  envBag: Record<string, string | undefined> = process.env,
): Promise<McpRuntime> {
  const env = loadMcpEnv(envBag);
  const ports = createPorts(env, envBag, {
    onChainRefund: gigEscrowConfigured()
      ? async (taskId: TaskId) => {
          await refundGigEscrow(taskId);
        }
      : undefined,
  });
  const session = createMemorySession();
  const tools = createTools(ports, session);
  tryBindEnvToken({ store: ports.connect, session, env: envBag });

  return { env, ports, tools, session };
}
