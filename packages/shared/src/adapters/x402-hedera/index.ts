import type { X402PaymentPort } from "../../ports/index.js";
import { createLiveX402Gate } from "./live.js";
import type { X402Env, X402Gate } from "./types.js";

export type { X402Env, X402Gate, X402Decision, PaidToolName } from "./types.js";
export {
  REQUEST_HEADER,
  RESPONSE_HEADER,
} from "./types.js";
export { buildRequirements, serializeChallenge } from "./requirements.js";

/** Live Hedera x402 only. Test doubles live in mock.ts + compose-test. */
export function createX402Gate(env: X402Env): X402Gate & X402PaymentPort {
  const gate = createLiveX402Gate(env);
  return {
    ...gate,
    async requirePayment() {
      throw new Error(
        "x402.requirePayment is not used on the live path — pay via pot debit or X-PAYMENT settle",
      );
    },
  };
}

export function defaultX402Env(
  partial: Partial<X402Env> & { port: number },
): X402Env {
  if (!partial.payTo?.trim()) {
    throw new Error("X402_PAY_TO required");
  }
  if (!partial.facilitatorUrl?.trim()) {
    throw new Error("X402_FACILITATOR_URL required");
  }
  return {
    port: partial.port,
    payTo: partial.payTo,
    facilitatorUrl: partial.facilitatorUrl,
    asset: partial.asset ?? "0.0.6001",
    priceBaseUnits: partial.priceBaseUnits ?? "10000",
  };
}
