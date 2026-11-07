import type { Address } from "../../types.js";

export type PaidToolName =
  | "post"
  | "post_gig"
  | "request_approval"
  | "cancel";

export type X402Env = {
  port: number;
  payTo: string;
  facilitatorUrl: string;
  asset: string;
  /** Meter in base units. Default 10000. */
  priceBaseUnits: string;
};

export type ExactRequirements = {
  scheme: "exact";
  network: "hedera:testnet";
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: "application/json";
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { name: string; decimals: number };
};

export type X402Challenge = {
  kind: "challenge";
  status: 402;
  json: string;
};

export type X402Allow = {
  kind: "allow";
  actor: { address: Address; receipt: string };
  responseHeader: { name: string; value: string };
};

export type X402Decision = X402Challenge | X402Allow;

export type X402Gate = {
  decide(i: {
    tool: PaidToolName;
    headers: Readonly<Record<string, string | undefined>>;
  }): Promise<X402Decision>;
  /** Settle only after the tool succeeded (graft from candidate A). */
  settle(i: {
    tool: PaidToolName;
    receipt: string;
    actor: Address;
  }): Promise<void>;
};

export const REQUEST_HEADER = "x-payment";
export const RESPONSE_HEADER = "x-payment-response";
