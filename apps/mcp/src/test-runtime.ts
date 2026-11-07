/**
 * Test-only MCP runtime. NODE_ENV=test required via createTestPorts.
 */
import { createTestPorts } from "@proofwork/shared/compose-test";
import type { ComposedPorts } from "@proofwork/shared/compose";
import type { Wei } from "@proofwork/shared";
import { tryBindEnvToken } from "./auth.js";
import { createMemorySession, type ToolSession } from "./session.js";
import { createTools, type Tools } from "./tools.js";

export type TestMcpRuntime = {
  ports: ComposedPorts;
  tools: Tools;
  session: ToolSession;
};

export function bootTestRuntime(
  envBag: Record<string, string | undefined> = {},
): TestMcpRuntime {
  process.env.NODE_ENV = "test";
  for (const [k, v] of Object.entries(envBag)) {
    if (v !== undefined) process.env[k] = v;
  }
  const ports = createTestPorts(process.env);
  const session = createMemorySession();
  const tools = createTools(ports, session);
  tryBindEnvToken({ store: ports.connect, session, env: process.env });
  return { ports, tools, session };
}
