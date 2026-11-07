/**
 * Stdio MCP smoke — uses stdio-mcp-test (NODE_ENV=test + createTestPorts).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpRoot = path.resolve(here, "..");
const repoRoot = path.resolve(mcpRoot, "../..");
const entry = path.join(mcpRoot, "src/stdio-mcp-test.ts");

function textOf(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  const parts = (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return parts.join("\n");
}

async function main() {
  const tsxBin = path.join(repoRoot, "node_modules/.bin/tsx");
  const transport = new StdioClientTransport({
    command: tsxBin,
    args: [entry],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PROOFWORK_MCP_BRIDGE: "inprocess",
      PROOFWORK_ACCOUNTS_PATH: "off",
    } as Record<string, string>,
    stderr: "inherit",
  });

  const client = new Client({
    name: "proofwork-smoke-stdio",
    version: "0.2.0",
  });

  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((t) => t.name).sort();
  const need = [
    "health",
    "issue_connect",
    "connect",
    "ensure_account",
    "pot_deposit",
    "post_gig",
  ];
  for (const n of need) {
    if (!names.includes(n)) throw new Error(`missing tool ${n}`);
  }

  const health = await client.callTool({ name: "health", arguments: {} });
  if (health.isError) throw new Error("health failed");

  const ensured = await client.callTool({
    name: "ensure_account",
    arguments: { nullifierHash: "0xstdio-smoke-human", label: "stdio" },
  });
  const ensuredText = textOf(ensured);
  if (ensured.isError) throw new Error(`ensure_account failed: ${ensuredText}`);
  const potId = /"potId"\s*:\s*"(0x[0-9a-fA-F]{40})"/.exec(ensuredText)?.[1];
  const owner = /"owner"\s*:\s*"(0x[0-9a-fA-F]{40})"/.exec(ensuredText)?.[1];
  if (!potId || !owner) throw new Error("ensure_account missing potId/owner");

  const dep = await client.callTool({
    name: "pot_deposit",
    arguments: {
      potId,
      owner,
      amountWei: "1000000000000",
    },
  });
  if (dep.isError) throw new Error(`pot_deposit failed: ${textOf(dep)}`);

  const issued = await client.callTool({
    name: "issue_connect",
    arguments: {
      potId,
      owner,
      ttl_secs: 600,
      label: "smoke-stdio",
    },
  });
  const issuedText = textOf(issued);
  if (issued.isError) throw new Error(`issue_connect failed: ${issuedText}`);
  const tokenMatch = /"token"\s*:\s*"(pwct_[^"]+)"/.exec(issuedText);
  const token = tokenMatch?.[1];
  if (!token) throw new Error("issue_connect missing token");

  const bound = await client.callTool({
    name: "connect",
    arguments: { token },
  });
  if (bound.isError) throw new Error(`connect failed: ${textOf(bound)}`);

  const now = Math.floor(Date.now() / 1000);
  const posted = await client.callTool({
    name: "post_gig",
    arguments: {
      rewardWei: "10000",
      metadata: "bafy-stdio-smoke",
      geo: { lat: 19.076, lng: 72.877 },
      deadline_at: now + 3600,
      max_work_secs: 1800,
    },
  });
  const postedText = textOf(posted);
  if (posted.isError) throw new Error(`post failed: ${postedText}`);

  const parsed = JSON.parse(postedText) as {
    result?: { taskId?: string };
  };
  if (!parsed.result?.taskId) throw new Error("post missing taskId");

  console.log("smoke:stdio ok", parsed.result.taskId);
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
