/**
 * Stdio MCP entry for smoke / test helpers — NODE_ENV=test + createTestPorts.
 * Not for production. Live agents use stdio-mcp.ts (loadMcpEnv + createPorts).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadRootEnv, monorepoRoot } from "./load-root-env.js";
import { createProofworkMcpServer } from "./mcp-bridge.js";
import { bootTestRuntime } from "./test-runtime.js";

if (process.env.NODE_ENV !== "test") {
  process.env.NODE_ENV = "test";
}

const repoRoot = monorepoRoot(import.meta.url);
if (process.cwd() !== repoRoot) {
  process.chdir(repoRoot);
  console.error(`proofwork mcp stdio (test): chdir ${repoRoot}`);
}

const rootEnv = loadRootEnv(import.meta.url);
if (rootEnv.loaded) {
  console.error(
    `proofwork mcp stdio (test): loaded root .env (${rootEnv.keys.length} new keys)`,
  );
}

async function main() {
  process.stdin.resume();
  const runtime = bootTestRuntime(process.env);
  const server = createProofworkMcpServer({
    kind: "inprocess",
    tools: runtime.tools,
    ports: runtime.ports,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("proofwork mcp stdio (test ports) ready");
}

process.on("uncaughtException", (err) => {
  console.error("proofwork mcp stdio (test) uncaught", err);
});
process.on("unhandledRejection", (err) => {
  console.error("proofwork mcp stdio (test) rejection", err);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
