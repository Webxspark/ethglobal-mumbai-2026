import { NextResponse } from "next/server";
import { oidcLoginConfigured } from "@proofwork/shared";
import { getWorldAuth } from "@/lib/worldAuth";
import { isLocalHostname, hostnameFromUrl, readPublicAppUrl } from "@/lib/public-url";

function looksStubId(value: string, prefixes: string[]): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return true;
  return prefixes.some((p) => v.startsWith(p));
}

/**
 * Product-honesty snapshot for the web UI.
 * Never claim World / Hedera live unless required keys are present.
 */
export async function GET(): Promise<Response> {
  const auth = getWorldAuth();
  const publicAppUrl = readPublicAppUrl();

  const idkitMissing: string[] = [];
  if (looksStubId(auth.config.idkit.appId, ["app_stub", "stub"])) {
    idkitMissing.push("WORLD_IDKIT_APP_ID");
  }
  if (looksStubId(auth.config.idkit.rpId, ["rp_stub", "stub"])) {
    idkitMissing.push("WORLD_IDKIT_RP_ID");
  }
  if (!auth.config.idkit.rpSigningKey.trim()) {
    idkitMissing.push("WORLD_IDKIT_RP_SIGNING_KEY");
  }

  const agentMissing: string[] = [];
  if (
    looksStubId(auth.config.agentPass.clientId, [
      "app_stub",
      "stub",
    ]) ||
    !auth.config.agentPass.clientId.trim()
  ) {
    agentMissing.push("WORLD_AGENT_PASS_CLIENT_ID");
  }
  if (!auth.config.agentPass.clientSecret.trim()) {
    agentMissing.push("WORLD_AGENT_PASS_CLIENT_SECRET");
  }

  const oidcMissing: string[] = [];
  if (!oidcLoginConfigured(auth.config)) {
    oidcMissing.push("WORLD_AGENT_PASS_CLIENT_ID");
    oidcMissing.push("WORLD_AGENT_PASS_CLIENT_SECRET");
  }

  const redirectUri = auth.config.oidc.redirectUri;
  const redirectLooksLocal =
    isLocalHostname(hostnameFromUrl(redirectUri)) ||
    isLocalHostname(hostnameFromUrl(publicAppUrl)) ||
    isLocalHostname(hostnameFromUrl(auth.config.publicAppUrl));

  const potAddress = process.env.NEXT_PUBLIC_BUDGET_POT_ADDRESS?.trim() || null;
  const wc = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || "";
  const walletConnectConfigured = wc.length >= 32 && !/^0+$/.test(wc);
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "296");

  const fundMissing: string[] = [];
  if (!potAddress || !/^0x[a-fA-F0-9]{40}$/.test(potAddress)) {
    fundMissing.push("NEXT_PUBLIC_BUDGET_POT_ADDRESS");
  }
  if (!walletConnectConfigured) {
    fundMissing.push("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID");
  }

  return NextResponse.json({
    world: {
      idkitReady: idkitMissing.length === 0,
      oidcReady: oidcLoginConfigured(auth.config) && !redirectLooksLocal,
      agentPassReady: agentMissing.length === 0 && !redirectLooksLocal,
      missing: [...new Set([...idkitMissing, ...agentMissing, ...oidcMissing])],
      redirectUri,
      redirectLooksLocal,
      publicAppUrl,
      appId: auth.config.idkit.appId,
      rpId: auth.config.idkit.rpId,
      action: auth.config.idkit.action,
      signinAction: auth.config.idkit.signinAction,
      environment: auth.config.idkit.environment,
      oidcIssuer: auth.config.oidc.issuer,
    },
    fund: {
      walletPayReady: fundMissing.length === 0,
      chainId,
      potAddress,
      walletConnectConfigured,
      missing: fundMissing,
      note:
        "Fund pot is one-click wallet pay (HBAR → BudgetPot). Server verifies the tx on Hashio, then credits the MCP pot store.",
    },
  });
}
