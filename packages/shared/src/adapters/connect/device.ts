import { randomBytes } from "node:crypto";
import type { Address, PotId, UnixSecs, Wei } from "../../types.js";
import { TERMS_TEXT, TERMS_VERSION } from "../../connect/terms.js";
import {
  createConnectTokenStore,
  type ConnectTokenStore,
  type ConnectTokenRecord,
} from "./tokens.js";

export type DeviceAuthStatus =
  | "pending_terms"
  | "pending_user"
  | "authorized"
  | "denied"
  | "expired";

export type DeviceAuthRecord = {
  readonly deviceCode: string;
  readonly userCode: string;
  status: DeviceAuthStatus;
  readonly termsVersion: string;
  termsAcceptedAt: UnixSecs | null;
  readonly authorizePath: string;
  readonly createdAt: UnixSecs;
  readonly expiresAt: UnixSecs;
  label: string | null;
  notifyUrl: string | null;
  maxBountyWei: Wei | null;
  nullifierHash: string | null;
  potId: PotId | null;
  owner: Address | null;
  token: string | null;
  tokenExpiresAt: UnixSecs | null;
};

export type StartDeviceInput = {
  publicAppUrl: string;
  ttlSecs?: number;
  label?: string | null;
  notifyUrl?: string | null;
  maxBountyWei?: Wei | null;
  now?: UnixSecs;
};

export type AcceptTermsInput = {
  deviceCode: string;
  agreed: boolean;
  termsVersion?: string;
  now?: UnixSecs;
};

export type ApproveDeviceInput = {
  deviceCode: string;
  nullifierHash: string;
  potId: PotId;
  owner: Address;
  ttlSecs?: number;
  now?: UnixSecs;
};

const DEFAULT_DEVICE_TTL = 900;
const MAX_DEVICE_TTL = 3600;

function mintDeviceCode(): string {
  return `pwdev_${randomBytes(16).toString("base64url")}`;
}

function mintUserCode(): string {
  // Short human-facing code for the authorize panel.
  return randomBytes(3).toString("hex").toUpperCase();
}

export function createDeviceAuthStore(
  opts: {
    clock?: () => UnixSecs;
    tokens?: ConnectTokenStore;
  } = {},
) {
  const now = () =>
    opts.clock
      ? opts.clock()
      : (Math.floor(Date.now() / 1000) as UnixSecs);
  const tokens = opts.tokens ?? createConnectTokenStore(opts.clock);
  const byCode = new Map<string, DeviceAuthRecord>();

  function sweep(rec: DeviceAuthRecord, at: UnixSecs): DeviceAuthRecord {
    if (rec.status === "authorized" || rec.status === "denied") return rec;
    if (rec.expiresAt <= at) {
      rec.status = "expired";
    }
    return rec;
  }

  function get(deviceCode: string): DeviceAuthRecord | null {
    const hit = byCode.get(deviceCode.trim());
    if (!hit) return null;
    return sweep(hit, now());
  }

  function start(input: StartDeviceInput): {
    device: DeviceAuthRecord;
    terms: string;
    termsVersion: string;
    authorizeUrl: string;
  } {
    const createdAt = input.now ?? now();
    const ttl = Math.min(
      Math.max(Math.floor(input.ttlSecs ?? DEFAULT_DEVICE_TTL), 60),
      MAX_DEVICE_TTL,
    );
    const deviceCode = mintDeviceCode();
    const userCode = mintUserCode();
    const authorizePath = `/connect/authorize?code=${encodeURIComponent(deviceCode)}`;
    const device: DeviceAuthRecord = {
      deviceCode,
      userCode,
      status: "pending_terms",
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: null,
      authorizePath,
      createdAt,
      expiresAt: (createdAt + ttl) as UnixSecs,
      label: input.label?.trim() || null,
      notifyUrl: input.notifyUrl?.trim() || null,
      maxBountyWei: input.maxBountyWei ?? null,
      nullifierHash: null,
      potId: null,
      owner: null,
      token: null,
      tokenExpiresAt: null,
    };
    byCode.set(deviceCode, device);
    const base = input.publicAppUrl.replace(/\/$/, "");
    return {
      device,
      terms: TERMS_TEXT,
      termsVersion: TERMS_VERSION,
      authorizeUrl: `${base}${authorizePath}`,
    };
  }

  function acceptTerms(input: AcceptTermsInput): DeviceAuthRecord {
    const hit = get(input.deviceCode);
    if (!hit) throw new Error("unknown device_code");
    if (hit.status === "expired") throw new Error("device_code expired");
    if (hit.status === "denied") throw new Error("device_code denied");
    if (hit.status === "authorized") return hit;
    if (!input.agreed) {
      hit.status = "denied";
      throw new Error("terms not agreed — cannot continue");
    }
    const ver = (input.termsVersion ?? "").trim() || TERMS_VERSION;
    if (ver !== TERMS_VERSION) {
      throw new Error(
        `terms_version mismatch — expected ${TERMS_VERSION}`,
      );
    }
    hit.termsAcceptedAt = input.now ?? now();
    hit.status = "pending_user";
    return hit;
  }

  function approve(input: ApproveDeviceInput): {
    device: DeviceAuthRecord;
    token: ConnectTokenRecord;
  } {
    const hit = get(input.deviceCode);
    if (!hit) throw new Error("unknown device_code");
    if (hit.status === "expired") throw new Error("device_code expired");
    if (hit.status === "denied") throw new Error("device_code denied");
    if (hit.status === "pending_terms") {
      throw new Error("agent must accept_terms before human approval");
    }
    if (hit.status === "authorized" && hit.token) {
      const existing = tokens.get(hit.token);
      if (existing) return { device: hit, token: existing };
    }
    if (!input.nullifierHash?.trim()) {
      throw new Error("nullifierHash required");
    }
    if (!input.potId) throw new Error("potId required");
    if (!input.owner) throw new Error("owner required");

    const token = tokens.mint({
      potId: input.potId,
      owner: input.owner,
      notifyUrl: hit.notifyUrl,
      maxBountyWei: hit.maxBountyWei,
      ttlSecs: input.ttlSecs,
      label: hit.label ?? "device-authorize",
      now: input.now ?? now(),
      nullifierHash: input.nullifierHash.trim(),
      termsVersion: hit.termsVersion,
    });

    hit.status = "authorized";
    hit.nullifierHash = input.nullifierHash.trim();
    hit.potId = input.potId;
    hit.owner = input.owner;
    hit.token = token.token;
    hit.tokenExpiresAt = token.expiresAt;
    return { device: hit, token };
  }

  function poll(deviceCode: string): DeviceAuthRecord | null {
    return get(deviceCode);
  }

  function deny(deviceCode: string): DeviceAuthRecord | null {
    const hit = get(deviceCode);
    if (!hit) return null;
    if (hit.status !== "authorized") hit.status = "denied";
    return hit;
  }

  return {
    tokens,
    start,
    acceptTerms,
    approve,
    poll,
    deny,
    get,
    termsText: () => TERMS_TEXT,
    termsVersion: () => TERMS_VERSION,
  };
}

export type DeviceAuthStore = ReturnType<typeof createDeviceAuthStore>;
