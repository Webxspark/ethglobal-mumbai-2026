/** Live countdowns for gig expiry + posting-agent respond SLA. */

/** Keep aligned with @proofwork/shared COUNTDOWN_WARN_SECS. */
export const COUNTDOWN_WARN_SECS = 300;

export function secsLeft(
  deadlineUnix: number | null | undefined,
  nowSecs = Math.floor(Date.now() / 1000),
): number | null {
  if (deadlineUnix == null) return null;
  return deadlineUnix - nowSecs;
}

export function formatCountdown(secs: number | null): string {
  if (secs == null) return "—";
  if (secs <= 0) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function zeroCountdownLabel(kind: "gig" | "work" | "sla"): string {
  if (kind === "work") return "Unassigned";
  if (kind === "sla") return "SLA missed";
  return "Expired";
}

export function displayCountdown(
  secs: number | null,
  kind: "gig" | "work" | "sla",
): string {
  if (secs == null) return "—";
  if (secs <= 0) return zeroCountdownLabel(kind);
  return formatCountdown(secs);
}

export function countdownToneClass(secs: number | null): string | undefined {
  if (secs == null) return undefined;
  if (secs <= 0) return "text-destructive";
  if (secs <= COUNTDOWN_WARN_SECS) return "text-[color:var(--warning)]";
  return undefined;
}

export function isPast(
  deadlineUnix: number | null | undefined,
  nowSecs = Math.floor(Date.now() / 1000),
): boolean {
  if (deadlineUnix == null) return false;
  return nowSecs >= deadlineUnix;
}
