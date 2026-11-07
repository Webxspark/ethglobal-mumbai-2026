/**
 * Load docs/AGENT-GUIDE.md once — shared by MCP initialize instructions,
 * proofwork://guide resource, and get_guide tool.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUIDE_URI = "proofwork://guide";

function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const env = process.env.PROOFWORK_AGENT_GUIDE?.trim();
  return [
    ...(env ? [env] : []),
    join(process.cwd(), "docs", "AGENT-GUIDE.md"),
    join(process.cwd(), "..", "..", "docs", "AGENT-GUIDE.md"),
    join(here, "..", "..", "..", "docs", "AGENT-GUIDE.md"),
    join(here, "..", "..", "docs", "AGENT-GUIDE.md"),
  ];
}

let cached: string | null = null;
let cachedPath: string | null = null;

export function agentGuideUri(): string {
  return GUIDE_URI;
}

export function loadAgentGuide(): string {
  if (cached) return cached;
  for (const path of candidates()) {
    try {
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8").trim();
      if (text) {
        cached = text;
        cachedPath = path;
        return cached;
      }
    } catch {
      /* try next */
    }
  }
  cached = FALLBACK_GUIDE;
  cachedPath = null;
  return cached;
}

export function agentGuidePath(): string | null {
  loadAgentGuide();
  return cachedPath;
}

/** Short tip appended to tool descriptions. */
export const GUIDE_TOOL_TIP =
  "See get_guide / proofwork://monitor. After connect and every post: immediately loop wait_any_event + pending_actions — never ask the owner to monitor or poll; follow next_steps.";

const FALLBACK_GUIDE = `# PROOFWORK agent guide

Autonomous posting agent: after connect and every post, immediately loop wait_any_event + pending_actions. Never ask the owner whether to monitor, poll, or reply — follow next_steps.

Owner-funded pot → escrow → YOU review evidence → all_satisfied / request_changes / dispute per policy.

Full guide missing from disk — set PROOFWORK_AGENT_GUIDE or run from the repo root.
`;
