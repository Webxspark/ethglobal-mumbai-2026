/** Edge-safe session seal/unseal (middleware + Node route handlers). */

export const SESSION_COOKIE = "pw_session";

export type ProofworkSession = {
  /** Account key — OIDC `sub` (or legacy nullifier). */
  nullifierHash: string;
  potId: string;
  owner: string;
  authMode: "live";
  createdAt: number;
  /** World verification level from OIDC acr / claims. */
  verificationLevel?: "orb" | "device" | "none";
  /** OIDC issuer when signed in via Sign in with World ID. */
  oidcIss?: string;
};

function secretBytes(): Uint8Array {
  const s =
    process.env.PROOFWORK_SESSION_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "proofwork-mumbai-dev-session";
  return new TextEncoder().encode(s);
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!);
  const b64 =
    typeof btoa === "function"
      ? btoa(bin)
      : Buffer.from(u8).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function hmacKey(): Promise<CryptoKey> {
  const raw = secretBytes();
  // Copy into a plain ArrayBuffer — Edge + Node both happy.
  const copy = new ArrayBuffer(raw.byteLength);
  new Uint8Array(copy).set(raw);
  return crypto.subtle.importKey(
    "raw",
    copy,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sealSession(
  session: ProofworkSession,
): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(session)));
  const key = await hmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${b64url(sig)}`;
}

export async function unsealSession(
  raw: string | undefined | null,
): Promise<ProofworkSession | null> {
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(sig).buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
    if (!ok) return null;
    const json = JSON.parse(
      new TextDecoder().decode(fromB64url(payload)),
    ) as ProofworkSession;
    if (!json?.nullifierHash || !json?.potId || !json?.owner) return null;
    return json;
  } catch {
    return null;
  }
}
