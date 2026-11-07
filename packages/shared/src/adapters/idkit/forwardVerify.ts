import { WorldAuthError } from "../../worldAuthTypes.js";

/**
 * Serialize an IDKit result for POST /api/v4/verify/{rp_id}.
 * Forward as-is — do not rebuild, remap, or drop fields (integrity_bundle
 * digests nonce + protocol_version + responses; timestamp must be <5 min).
 * Only fills documented `environment` when IDKit omitted it.
 */
export function serializeIdKitVerifyBody(
  proof: unknown,
  expectedEnvironment: "staging" | "production",
  logLabel = "[idkit/verify]",
): { body: string; keys: string[] } {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    throw new WorldAuthError("invalid_proof", "expected IDKit payload object");
  }

  const raw = proof as Record<string, unknown>;
  const keys = Object.keys(raw);
  console.info(`${logLabel} request payload keys + env`, {
    keys,
    environment: raw.environment ?? expectedEnvironment,
  });

  const bundle = raw.integrity_bundle;
  if (bundle && typeof bundle === "object" && !Array.isArray(bundle)) {
    console.info(
      `${logLabel} integrity_bundle keys`,
      Object.keys(bundle as Record<string, unknown>),
    );
  }

  // Only add environment when missing — never overwrite / reorder other fields.
  const toSend =
    raw.environment == null || raw.environment === ""
      ? { ...raw, environment: expectedEnvironment }
      : raw;

  return { body: JSON.stringify(toSend), keys: Object.keys(toSend) };
}
