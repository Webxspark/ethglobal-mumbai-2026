import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Address, PotId, UnixSecs, Wei } from "../../types.js";
import { normalizeLegacyMoneyField } from "../../money.js";

/** Short-lived proofwork_connect binding — agent ↔ pot. */
export type ConnectTokenRecord = {
  readonly token: string;
  readonly potId: PotId;
  readonly owner: Address;
  readonly notifyUrl: string | null;
  readonly maxBountyWei: Wei | null;
  readonly expiresAt: UnixSecs;
  readonly createdAt: UnixSecs;
  readonly label: string | null;
  /** World nullifier of the human who authorized (device flow). */
  readonly nullifierHash: string | null;
  /** Terms version the agent accepted before mint (null = owner-minted). */
  readonly termsVersion: string | null;
};

export type MintConnectInput = {
  potId: PotId;
  owner: Address;
  notifyUrl?: string | null;
  maxBountyWei?: Wei | null;
  /** TTL seconds from now. Default 3600. Cap 86400. */
  ttlSecs?: number;
  label?: string | null;
  /** Optional fixed token (tests). Otherwise random `pwct_…`. */
  token?: string;
  now?: UnixSecs;
  nullifierHash?: string | null;
  termsVersion?: string | null;
};

export type ConnectSession = {
  readonly potId: PotId;
  readonly owner: Address;
  readonly notifyUrl: string | null;
  readonly maxBountyWei: Wei | null;
  readonly token: string;
  readonly expiresAt: UnixSecs;
  readonly label?: string | null;
  readonly nullifierHash: string | null;
  readonly termsVersion: string | null;
};

export class ConnectAuthError extends Error {
  readonly status = 401 as const;
  constructor(message: string) {
    super(message);
    this.name = "ConnectAuthError";
  }
}

function parseEnvSecs(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Agent sessions default to 30d — persisted on disk so reconnect does not need re-approval. */
const DEFAULT_TTL = parseEnvSecs("PROOFWORK_CONNECT_DEFAULT_TTL_SECS", 2_592_000);
const MAX_TTL = parseEnvSecs("PROOFWORK_CONNECT_MAX_TTL_SECS", 7_776_000);

type DiskShape = {
  version: 1 | 2;
  tokens: Array<{
    token: string;
    potId: string;
    owner: string;
    notifyUrl: string | null;
    maxBountyWei: string | null;
    expiresAt: number;
    createdAt: number;
    label: string | null;
    nullifierHash: string | null;
    termsVersion: string | null;
  }>;
};

function mintRawToken(): string {
  return `pwct_${randomBytes(18).toString("base64url")}`;
}

function defaultPersistPath(): string | null {
  const fromEnv = process.env.PROOFWORK_CONNECT_TOKENS_PATH?.trim();
  if (
    fromEnv === "off" ||
    fromEnv === "memory" ||
    fromEnv === ":memory:"
  ) {
    return null;
  }
  if (fromEnv) return fromEnv;
  // Share the accounts "off" switch so unit tests stay ephemeral.
  const accounts = process.env.PROOFWORK_ACCOUNTS_PATH?.trim();
  if (
    accounts === "off" ||
    accounts === "memory" ||
    accounts === ":memory:"
  ) {
    return null;
  }
  try {
    return join(process.cwd(), ".data", "connect-tokens.json");
  } catch {
    return null;
  }
}

export function createConnectTokenStore(
  clock?: () => UnixSecs,
  opts?: { persistPath?: string | null },
) {
  const now = () =>
    clock ? clock() : (Math.floor(Date.now() / 1000) as UnixSecs);
  const byToken = new Map<string, ConnectTokenRecord>();
  const persistPath =
    opts && "persistPath" in opts ? opts.persistPath : defaultPersistPath();

  function flush() {
    if (!persistPath) return;
    try {
      mkdirSync(dirname(persistPath), { recursive: true });
      const at = now();
      const payload: DiskShape = {
        version: 2,
        tokens: [...byToken.values()]
          .filter((r) => r.expiresAt > at)
          .map((r) => ({
            token: r.token,
            potId: r.potId,
            owner: r.owner,
            notifyUrl: r.notifyUrl,
            maxBountyWei:
              r.maxBountyWei == null ? null : r.maxBountyWei.toString(),
            expiresAt: r.expiresAt,
            createdAt: r.createdAt,
            label: r.label,
            nullifierHash: r.nullifierHash,
            termsVersion: r.termsVersion,
          })),
      };
      writeFileSync(persistPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
      console.warn("[connect-tokens] failed to persist", err);
    }
  }

  function hydrate() {
    if (!persistPath || !existsSync(persistPath)) return;
    try {
      const raw = readFileSync(persistPath, "utf8");
      const parsed = JSON.parse(raw) as DiskShape;
      const legacy = parsed.version === 1 || parsed.version == null;
      const at = now();
      for (const row of parsed.tokens ?? []) {
        if (!row?.token?.startsWith("pwct_") || !row.potId || !row.owner) {
          continue;
        }
        if (row.expiresAt <= at) continue;
        const maxRaw =
          row.maxBountyWei == null
            ? null
            : (legacy
                ? normalizeLegacyMoneyField(BigInt(row.maxBountyWei))
                : BigInt(row.maxBountyWei));
        byToken.set(row.token, {
          token: row.token,
          potId: row.potId as PotId,
          owner: row.owner as Address,
          notifyUrl: row.notifyUrl ?? null,
          maxBountyWei:
            maxRaw == null ? null : (maxRaw as Wei),
          expiresAt: row.expiresAt as UnixSecs,
          createdAt: row.createdAt as UnixSecs,
          label: row.label ?? null,
          nullifierHash: row.nullifierHash ?? null,
          termsVersion: row.termsVersion ?? null,
        });
      }
    } catch (err) {
      console.warn("[connect-tokens] failed to load persist file", err);
    }
  }

  hydrate();

  function mint(input: MintConnectInput): ConnectTokenRecord {
    if (!input.potId) throw new Error("potId required");
    if (!input.owner) throw new Error("owner required");
    const ttlRaw = input.ttlSecs ?? DEFAULT_TTL;
    const ttl = Math.min(Math.max(Math.floor(ttlRaw), 60), MAX_TTL);
    const createdAt = input.now ?? now();
    const record: ConnectTokenRecord = {
      token: input.token?.trim() || mintRawToken(),
      potId: input.potId,
      owner: input.owner,
      notifyUrl: input.notifyUrl?.trim() || null,
      maxBountyWei: input.maxBountyWei ?? null,
      expiresAt: (createdAt + ttl) as UnixSecs,
      createdAt,
      label: input.label?.trim() || null,
      nullifierHash: input.nullifierHash?.trim() || null,
      termsVersion: input.termsVersion?.trim() || null,
    };
    byToken.set(record.token, record);
    flush();
    return record;
  }

  function get(token: string): ConnectTokenRecord | null {
    const hit = byToken.get(token);
    if (!hit) return null;
    if (hit.expiresAt <= now()) {
      byToken.delete(token);
      flush();
      return null;
    }
    return hit;
  }

  function resolve(token: string | null | undefined): ConnectSession {
    const raw = token?.trim();
    if (!raw) {
      throw new ConnectAuthError("connect token required");
    }
    const hit = get(raw);
    if (!hit) {
      throw new ConnectAuthError("unknown or expired connect token");
    }
    return {
      potId: hit.potId,
      owner: hit.owner,
      notifyUrl: hit.notifyUrl,
      maxBountyWei: hit.maxBountyWei,
      token: hit.token,
      expiresAt: hit.expiresAt,
      label: hit.label,
      nullifierHash: hit.nullifierHash,
      termsVersion: hit.termsVersion,
    };
  }

  function revoke(token: string): boolean {
    const ok = byToken.delete(token);
    if (ok) flush();
    return ok;
  }

  function size(): number {
    // Drop expired while counting so tests stay honest.
    let dirty = false;
    const at = now();
    for (const [k, v] of byToken) {
      if (v.expiresAt <= at) {
        byToken.delete(k);
        dirty = true;
      }
    }
    if (dirty) flush();
    return byToken.size;
  }

  return { mint, get, resolve, revoke, size };
}

export type ConnectTokenStore = ReturnType<typeof createConnectTokenStore>;

/** Pull bearer / X-PROOFWORK-CONNECT from a header map (lower or mixed case). */
export function extractConnectToken(
  headers: Record<string, string | undefined>,
): string | null {
  const pick = (k: string) => {
    const direct = headers[k];
    if (direct) return direct;
    const lower = headers[k.toLowerCase()];
    if (lower) return lower;
    // case-insensitive scan
    const want = k.toLowerCase();
    for (const [hk, hv] of Object.entries(headers)) {
      if (hk.toLowerCase() === want && hv) return hv;
    }
    return undefined;
  };

  const dedicated = pick("x-proofwork-connect") ?? pick("X-PROOFWORK-CONNECT");
  if (dedicated?.trim()) return dedicated.trim();

  const auth = pick("authorization") ?? pick("Authorization");
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m?.[1]?.trim() || null;
}
