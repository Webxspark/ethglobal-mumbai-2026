"use client";

import { useChainId } from "wagmi";
import { hederaTestnet, PRIMARY_CHAIN_ID } from "@/lib/wagmi/chains";

/** Live chain readout — only mount inside WagmiProvider (via useWeb3Ready). */
export function NetworkBadgeLive() {
  const chainId = useChainId();
  const onHedera = chainId === hederaTestnet.id;
  const label =
    chainId === hederaTestnet.id
      ? "Hedera testnet"
      : chainId
        ? `Chain ${chainId}`
        : "Hedera testnet";

  return (
    <span
      className={`pw-net-badge ${onHedera ? "pw-net-badge--ok" : "pw-net-badge--warn"}`}
      title={`EVM chain id ${chainId || PRIMARY_CHAIN_ID}`}
    >
      <span className="pw-net-badge__dot" aria-hidden />
      {label}
    </span>
  );
}
