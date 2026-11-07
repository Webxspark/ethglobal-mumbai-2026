/**
 * Official MCP stdio bridge for OpenCode / Cursor / Claude Desktop.
 *
 * Prefer HTTP bridge so OpenCode shares compose with the web Review inbox:
 *   PROOFWORK_MCP_BRIDGE=http
 *   PROOFWORK_MCP_HTTP=http://127.0.0.1:38472
 *   # or deployed: https://<deploy>/api/mcp
 *   PROOFWORK_CONNECT_TOKEN=pwct_…
 *
 * In-process mode still boots live compose (loadMcpEnv + createPorts) — needs full env.
 * For test helpers with NODE_ENV=test, use src/stdio-mcp-test.ts instead.
 *
 * Paid tools need a real X-PAYMENT / x402 settlement (or PROOFWORK_MCP_X_PAYMENT).
 *
 * Logs go to stderr — stdout is MCP JSON-RPC only.
 * OpenCode must spawn this file with an absolute path (or cwd = repo root);
 * relative `apps/mcp/...` from ~/.config/opencode dies with "Connection closed".
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadRootEnv, monorepoRoot } from "./load-root-env.js";
import {
  createHttpBridgeAuth,
  createProofworkMcpServer,
  type BridgeBackend,
} from "./mcp-bridge.js";
import { bootRuntime } from "./runtime.js";

const repoRoot = monorepoRoot(import.meta.url);
if (process.cwd() !== repoRoot) {
  process.chdir(repoRoot);
  console.error(`proofwork mcp stdio: chdir ${repoRoot}`);
}

const rootEnv = loadRootEnv(import.meta.url);
if (rootEnv.loaded) {
  console.error(
    `proofwork mcp stdio: loaded root .env (${rootEnv.keys.length} new keys)`,
  );
}

function bridgeMode(
  env: Record<string, string | undefined>,
): "inprocess" | "http" {
  const raw = (env.PROOFWORK_MCP_BRIDGE ?? "http").toLowerCase();
  if (raw === "inprocess" || raw === "local" || raw === "offline") {
    return "inprocess";
  }
  return "http";
}

async function main() {
  process.stdin.resume();

  const mode = bridgeMode(process.env);
  let backend: BridgeBackend;
  const connectToken = process.env.PROOFWORK_CONNECT_TOKEN?.trim();

  if (mode === "http") {
    const baseUrl =
      process.env.PROOFWORK_MCP_HTTP ?? "http://127.0.0.1:38472";
    backend = {
      kind: "http",
      baseUrl,
      auth: createHttpBridgeAuth(connectToken),
    };
    console.error(
      `proofwork mcp stdio → HTTP proxy ${baseUrl}${connectToken ? " (connect token set)" : " (connect token sticky after connect)"}`,
    );
  } else {
    const runtime = await bootRuntime(process.env);
    backend = {
      kind: "inprocess",
      tools: runtime.tools,
      ports: runtime.ports,
    };
    const b = runtime.ports.health.backends;
    console.error(
      `proofwork mcp stdio in-process (backends: x402=${b.x402} hcs=${b.hcs} arkiv=${b.arkiv} world=${b.world})`,
    );
    console.error(
      "tip: offline smoke only — prefer PROOFWORK_MCP_BRIDGE=http so web + agent share one MCP",
    );
  }

  const server = createProofworkMcpServer(backend);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("proofwork mcp stdio ready");
}

process.on("uncaughtException", (err) => {
  console.error("proofwork mcp stdio uncaught", err);
});
process.on("unhandledRejection", (err) => {
  console.error("proofwork mcp stdio rejection", err);
});

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
