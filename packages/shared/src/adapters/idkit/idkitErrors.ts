/** Human-readable copy for IDKit / World Auth failure codes. */
const COPY: Record<string, string> = {
  duplicate_nonce:
    "This World ID request reused an old signature. Close the QR and try Sign in again — each attempt needs a fresh nonce.",
  signup_already_completed:
    "Sign in uses World OpenID Connect now (not IDKit sessions). Use Sign in with World ID on the landing page.",
  invalid_rp_signature:
    "World rejected our request signature. Check the RP signing key and that the server clock is roughly correct.",
  timestamp_too_old:
    "The sign-in request expired. Close the widget and open Sign in again for a fresh signature.",
  timestamp_too_far_in_future:
    "Server clock looks ahead of World. Fix the clock and retry.",
  rp_signature_expired:
    "The RP signature expired. Close the QR and try again.",
  user_rejected: "You cancelled World ID verification.",
  verification_rejected: "You cancelled World ID verification.",
  cancelled: "You cancelled World ID verification.",
  failed_by_host_app:
    "World App returned a proof but our server rejected it. Check the error detail below.",
  environment_mismatch:
    "Staging/production mismatch between this app and the World proof. Align WORLD_IDKIT_ENVIRONMENT with the Portal action.",
  invalid_network:
    "Environment mismatch between the app and World App. Use staging with the simulator, production with the real app.",
  unknown_rp: "This relying party is not registered in the Developer Portal.",
  inactive_rp: "This relying party is inactive in the Developer Portal.",
  verify_failed: "World could not verify the proof.",
  banned_nullifier: "This World ID is banned on Proofwork.",
  missing_nullifier: "Verified proof did not include a nullifier.",
  claim_nullifier_mismatch:
    "This World ID does not match the human who verified for gig claim on this account.",
  claim_nullifier_other_account:
    "This World ID already verified gig claim on a different Proofwork account. Sign in with that account or use another World ID.",
  claim_poh_not_bound:
    "Complete World verification once on this account before claiming again.",
  invalid_proof: "Missing or malformed World ID proof.",
  connection_failed: "Could not reach World App / bridge. Check connectivity and retry.",
  generic_error: "World IDKit hit an unexpected error. Try again.",
  session_unknown:
    "No account is linked to this World session yet. Complete signup once, then return in the same browser.",
  session_nullifier_replayed:
    "That session proof was already used. Open Sign in again for a fresh proof.",
};

const TECHNICAL_DETAIL =
  /^(validation_error|verify_failed|nullifier_replayed|max_verifications_reached)$/i;

function detailSafeForUi(detail: string, base: string): string | null {
  const extra = detail.trim();
  if (!extra) return null;
  if (extra === base || extra.includes(base)) return null;
  if (extra.startsWith("{") || extra.startsWith("[")) return null;
  if (/"(transport|protocol_version|integrity_bundle)"/i.test(extra)) return null;
  if (TECHNICAL_DETAIL.test(extra)) return null;
  if (extra.length > 160) return null;
  return extra;
}

export function readableIdKitError(
  code: string | null | undefined,
  detail?: string | null,
): string {
  const key = (code ?? "").trim();
  if (isIdKitReplayCode(key)) {
    return COPY.verify_failed ?? "World could not verify the proof.";
  }
  const mapped = (key && COPY[key]) || null;
  const detailKey = (detail ?? "").trim();
  if (detailKey && COPY[detailKey]) return COPY[detailKey]!;
  const base = mapped || (key ? `World IDKit: ${key}` : "World IDKit failed");
  if (key === "verify_failed" && TECHNICAL_DETAIL.test(detailKey)) return base;
  const safe = detailSafeForUi(detailKey, base);
  if (!safe || safe === key || safe === base) return base;
  return `${base} (${safe})`;
}

/** True when World reports the human already proved for this gig action. */
export function isIdKitReplayCode(code: string | null | undefined): boolean {
  return /nullifier_replayed|max_verifications_reached|already_verified/i.test(
    (code ?? "").trim(),
  );
}
