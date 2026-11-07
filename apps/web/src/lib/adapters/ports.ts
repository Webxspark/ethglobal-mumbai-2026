"use client";

/**
 * Composition root for worker-ui — always MCP HTTP to compose
 * (`npm start` / `dev:mcp`, rewrite `/api/mcp`).
 */
import { mcpPorts, mcpSetThreshold } from "./mcp-ports";
import type { Wei } from "@proofwork/shared/browser";

export const ports = mcpPorts;

export async function setAgentPassThreshold(wei: Wei): Promise<void> {
  await mcpSetThreshold(wei);
}
