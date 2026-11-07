"use client";

import { clientPublicAppUrl } from "@/lib/client-public-url";

/** Deployed Continuity-friendly origin — localhost redirects get rejected. */
export const PROOFWORK_LIVE_ORIGIN = clientPublicAppUrl();

export type HonestyStatus = {
  world: {
    idkitReady: boolean;
    /** Sign in with World ID (OIDC) — reuses Agent Pass client by default. */
    oidcReady: boolean;
    agentPassReady: boolean;
    missing: string[];
    redirectUri: string;
    redirectLooksLocal: boolean;
    publicAppUrl?: string;
    appId: string;
    rpId: string;
    action: string;
    signinAction: string;
    environment: "staging" | "production";
    oidcIssuer?: string;
  };
  fund: {
    walletPayReady: boolean;
    chainId: number;
    potAddress: string | null;
    walletConnectConfigured: boolean;
    missing: string[];
    note: string;
  };
};

/** Always require real keys + MCP — kept for call sites that gate “honest” UI. */
export function mustBeHonest(): boolean {
  return true;
}

export async function fetchHonestyStatus(): Promise<HonestyStatus> {
  const res = await fetch("/api/proofwork/status", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`honesty status HTTP ${res.status}`);
  }
  return (await res.json()) as HonestyStatus;
}

export function worldBlockedCopy(status: HonestyStatus): string {
  const miss =
    status.world.missing.length > 0
      ? `Missing: ${status.world.missing.join(", ")}.`
      : "World auth keys incomplete.";
  const live = status.world.publicAppUrl ?? PROOFWORK_LIVE_ORIGIN;
  const local = status.world.redirectLooksLocal
    ? ` Continuity rejects most localhost redirects — use ${live} (set WORLD_AGENT_PASS_REDIRECT_URI + PROOFWORK_PUBLIC_URL / NEXT_PUBLIC_PROOFWORK_PUBLIC_URL).`
    : "";
  return `World Proof of Human is not fully configured. ${miss}${local} Do not fake PoH.`;
}

export function fundReadyCopy(status: HonestyStatus): string {
  if (status.fund.walletPayReady) {
    return `Wallet pay ready on chain ${status.fund.chainId}.`;
  }
  const miss =
    status.fund.missing.length > 0
      ? `Missing: ${status.fund.missing.join(", ")}.`
      : status.fund.note;
  return miss;
}
