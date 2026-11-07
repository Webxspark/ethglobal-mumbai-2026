"use client";

/**
 * Worker web always talks to MCP HTTP compose (no offline mock ports).
 */
export function isMcpMode(): boolean {
  return true;
}
