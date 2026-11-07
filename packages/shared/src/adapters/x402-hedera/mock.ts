import { createHash } from "node:crypto";
import type { Address } from "../../types.js";
import { buildRequirements, serializeChallenge } from "./requirements.js";
import {
  REQUEST_HEADER,
  RESPONSE_HEADER,
  type PaidToolName,
  type X402Decision,
  type X402Env,
  type X402Gate,
} from "./types.js";

function sha16(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function isAddress(v: unknown): v is Address {
  return typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
}

export function createMockX402Gate(env: X402Env): X402Gate {
  const settled = new Set<string>();

  return {
    async decide({ tool, headers }): Promise<X402Decision> {
      const reqs = buildRequirements(tool, env);
      const raw = headers[REQUEST_HEADER] ?? headers["X-PAYMENT"];

      if (!raw || raw.trim() === "") {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "X-PAYMENT header is required"),
        };
      }

      // Demo shortcut: literal "mock" settles as a synthetic payer.
      if (raw.trim() === "mock") {
        const receipt = `mock-settle:${tool}:${sha16(`mock:${tool}`)}`;
        const actor =
          "0x1111111111111111111111111111111111111111" as Address;
        const response = Buffer.from(
          JSON.stringify({
            success: true,
            transaction: receipt,
            network: "hedera:testnet",
            payer: actor,
            pendingSettle: true,
          }),
        ).toString("base64");
        return {
          kind: "allow",
          actor: { address: actor, receipt },
          responseHeader: { name: RESPONSE_HEADER, value: response },
        };
      }

      let decoded: unknown;
      try {
        decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      } catch {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "invalid X-PAYMENT"),
        };
      }

      const obj = decoded as {
        scheme?: string;
        network?: string;
        payload?: {
          authorization?: { from?: string; value?: string };
        };
      };

      if (obj.scheme !== "exact" || obj.network !== "hedera:testnet") {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "unsupported scheme"),
        };
      }

      const value = obj.payload?.authorization?.value;
      const from = obj.payload?.authorization?.from;
      if (value !== reqs.maxAmountRequired) {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "amount_mismatch"),
        };
      }
      if (!isAddress(from)) {
        return {
          kind: "challenge",
          status: 402,
          json: serializeChallenge(reqs, "payer address"),
        };
      }

      const receipt = `mock-settle:${tool}:${sha16(raw)}`;
      const response = Buffer.from(
        JSON.stringify({
          success: true,
          transaction: receipt,
          network: "hedera:testnet",
          payer: from,
          pendingSettle: true,
        }),
      ).toString("base64");

      return {
        kind: "allow",
        actor: { address: from, receipt },
        responseHeader: { name: RESPONSE_HEADER, value: response },
      };
    },

    async settle({ receipt }) {
      settled.add(receipt);
    },
  };
}

/** Closed-door port implementation for type compat. */
export async function mockRequirePayment(i: {
  tool: string;
  payer: string;
}): Promise<{ receipt: string }> {
  return {
    receipt: `mock-settle:${i.tool}:${sha16(`${i.payer}:${i.tool}`)}`,
  };
}
