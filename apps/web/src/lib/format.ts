import {
  EscrowStatus,
  TINYBAR_PER_HBAR,
  type Wei,
} from "@proofwork/shared/browser";

export function tinybarToNumber(tinybar: Wei | bigint): number {
  return Number(tinybar) / Number(TINYBAR_PER_HBAR);
}

/** Human-readable HBAR — internal amounts are tinybar (8 decimals). */
export function formatHbar(tinybar: Wei | bigint, digits = 4): string {
  const n = tinybarToNumber(tinybar);
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(n);
  return `${formatted} HBAR`;
}

/** @deprecated Use formatHbar — amounts are HBAR, not USD. */
export const formatUsd = formatHbar;

export function parseHbarToWei(raw: string): Wei {
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Enter a valid amount");
  }
  return BigInt(Math.round(n * Number(TINYBAR_PER_HBAR))) as Wei;
}

/** @deprecated Use parseHbarToWei */
export const parseUsdToWei = parseHbarToWei;

export function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatDistanceM(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function statusLabel(status: EscrowStatus | string): string {
  switch (status) {
    case EscrowStatus.Open:
      return "Open";
    case EscrowStatus.Accepted:
      return "Accepted";
    case EscrowStatus.Submitted:
      return "In review";
    case EscrowStatus.Verified:
      return "Verified";
    case EscrowStatus.Paid:
      return "Paid";
    case EscrowStatus.Cancelled:
      return "Cancelled";
    case EscrowStatus.Refunded:
      return "Refunded";
    case EscrowStatus.Disputed:
      return "Reported";
    case EscrowStatus.Expired:
      return "Expired";
    case EscrowStatus.ExpiredSla:
      return "SLA refunded";
    default:
      return String(status);
  }
}

/** Relative to the demo clock used by mock fixtures (stable for prerender). */
const DEMO_NOW = 1_730_820_000;

export function relativeTime(unixSecs: number, nowSecs = DEMO_NOW): string {
  const delta = Math.max(0, nowSecs - unixSecs);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}
