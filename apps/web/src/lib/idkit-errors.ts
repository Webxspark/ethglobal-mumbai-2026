import { isIdKitReplayCode, readableIdKitError } from "@proofwork/shared";

/** Browser-side wrapper — never forwards raw IDKit JSON to UI. */
export function formatIdKitError(
  code: string | null | undefined,
  detail?: unknown,
): string {
  if (isIdKitReplayCode(code)) {
    return readableIdKitError("verify_failed", null);
  }
  if (detail && typeof detail === "object") {
    if (process.env.NODE_ENV !== "production") {
      console.info("[idkit] widget detail (server/UI sanitized)", detail);
    }
    return readableIdKitError(code, null);
  }
  const extra = typeof detail === "string" ? detail : "";
  if (isIdKitReplayCode(extra)) {
    return readableIdKitError("verify_failed", null);
  }
  return readableIdKitError(code, extra || null);
}
