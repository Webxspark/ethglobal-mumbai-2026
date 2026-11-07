import { isIdKitReplayCode } from "@proofwork/shared";

export { isIdKitReplayCode };

function looksLikeIdKitPayload(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  return (
    Array.isArray(d.responses) ||
    typeof d.action === "string" ||
    typeof d.protocol_version === "string"
  );
}

/** Pull an IDKit result object out of widget debug payloads without surfacing them. */
export function proofFromIdKitDebug(debug: unknown): unknown | null {
  if (!debug) return null;
  if (typeof debug === "string") {
    try {
      const parsed = JSON.parse(debug) as unknown;
      return proofFromIdKitDebug(parsed);
    } catch {
      return null;
    }
  }
  if (looksLikeIdKitPayload(debug)) return debug;
  if (typeof debug !== "object") return null;
  const d = debug as Record<string, unknown>;
  const keys = [
    "proof",
    "idkitResponse",
    "result",
    "payload",
    "idkit",
    "response",
    "data",
  ];
  for (const k of keys) {
    const nested = d[k];
    if (looksLikeIdKitPayload(nested)) return nested;
  }
  if (d.bridge && typeof d.bridge === "object") {
    const fromBridge = proofFromIdKitDebug(d.bridge);
    if (fromBridge) return fromBridge;
  }
  for (const v of Object.values(d)) {
    if (looksLikeIdKitPayload(v)) return v;
  }
  return null;
}
