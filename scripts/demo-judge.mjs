#!/usr/bin/env node
/**
 * One-shot judge helper.
 * Prints the cold script, makes sure MCP answers, runs smoke:ui.
 *
 *   npm run demo:judge
 *
 * Optional: SKIP_SMOKE=1 npm run demo:judge   (print script only)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcpBase = process.env.MCP_URL ?? "http://127.0.0.1:38472";
const webBase = process.env.PROOFWORK_PUBLIC_URL ?? "http://127.0.0.1:38471";

function say(msg) {
  console.log(msg);
}

function printColdScript() {
  const path = join(root, "docs/JUDGE-DEMO.md");
  let body = "";
  try {
    body = readFileSync(path, "utf8");
  } catch {
    body = "(docs/JUDGE-DEMO.md missing)";
  }

  say("\n=== JUDGE COLD SCRIPT (from docs/JUDGE-DEMO.md) ===\n");
  // Keep it short — judges don't need the whole file dumped.
  const lines = body.split("\n").slice(0, 82);
  for (const line of lines) say(line);
  say("\n… full script: docs/JUDGE-DEMO.md\n");
  say(`Web:  ${webBase}`);
  say(`MCP:  ${mcpBase}`);
  say("Stills: docs/screenshots/proofwork-agent-pass.png, proofwork-idkit.png\n");
}

async function mcpUp() {
  try {
    const res = await fetch(`${mcpBase}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const j = await res.json();
    return j?.ok === true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited ${code}`));
    });
  });
}

async function bootMcpIfNeeded() {
  if (await mcpUp()) {
    say("mcp already up");
    return null;
  }
  say("mcp not answering — starting npm run dev:mcp …");
  const child = spawn("npm", ["run", "dev:mcp"], {
    cwd: root,
    stdio: "ignore",
    env: process.env,
    detached: true,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await mcpUp()) {
      say("mcp ready");
      return child;
    }
  }
  throw new Error("mcp failed to come up on " + mcpBase);
}

async function main() {
  printColdScript();

  if (process.env.SKIP_SMOKE === "1") {
    say("SKIP_SMOKE=1 — not running smoke:ui");
    say("Manual: npm run dev:mcp && NEXT_PUBLIC_PROOFWORK_MODE=mcp npm run dev");
    return;
  }

  await bootMcpIfNeeded();
  say("\n— smoke:ui (post → accept → TeeML → PAID) —\n");
  await runNpm(["run", "smoke:ui"]);
  say("\ndemo:judge ok");
  say("Next: NEXT_PUBLIC_PROOFWORK_MODE=mcp npm run dev");
  say(`Then click ${webBase}/worker/tasks`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
