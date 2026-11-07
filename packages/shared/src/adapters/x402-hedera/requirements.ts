import type { ExactRequirements, PaidToolName, X402Env } from "./types.js";

export function maxAmountRequired(
  tool: PaidToolName,
  env: X402Env,
): string {
  void tool;
  return env.priceBaseUnits;
}

export function buildRequirements(
  tool: PaidToolName,
  env: X402Env,
  host?: string,
): ExactRequirements {
  const authority = host?.trim() || `127.0.0.1:${env.port}`;
  return {
    scheme: "exact",
    network: "hedera:testnet",
    maxAmountRequired: maxAmountRequired(tool, env),
    resource: `http://${authority}/tools/${tool}`,
    description: `PROOFWORK MCP ${tool}`,
    mimeType: "application/json",
    payTo: env.payTo,
    maxTimeoutSeconds: 300,
    asset: env.asset,
    extra: { name: "HBAR", decimals: 18 },
  };
}

export function serializeChallenge(
  reqs: ExactRequirements,
  error: string,
): string {
  return JSON.stringify({
    x402Version: 1,
    error,
    accepts: [reqs],
  });
}
