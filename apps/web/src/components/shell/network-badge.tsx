"use client";

import { useWeb3Ready } from "@/components/providers/web3-ready";
import { hederaTestnet, PRIMARY_CHAIN_ID } from "@/lib/wagmi/chains";
import { NetworkBadgeLive } from "@/components/shell/network-badge-live";

/** Static badge — safe during SSR / prerender before WagmiProvider exists. */
function NetworkBadgeStatic() {
  const onHedera = PRIMARY_CHAIN_ID === hederaTestnet.id;
  return (
    <span
      className={`pw-net-badge ${onHedera ? "pw-net-badge--ok" : "pw-net-badge--warn"}`}
      title={`EVM chain id ${PRIMARY_CHAIN_ID}`}
    >
      <span className="pw-net-badge__dot" aria-hidden />
      {onHedera ? "Hedera testnet" : `Chain ${PRIMARY_CHAIN_ID}`}
    </span>
  );
}

export function NetworkBadge() {
  const ready = useWeb3Ready();
  if (!ready) return <NetworkBadgeStatic />;
  return <NetworkBadgeLive />;
}
