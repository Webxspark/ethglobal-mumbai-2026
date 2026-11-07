"use client";

import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useState } from "react";
import { Web3ReadyContext } from "@/components/providers/web3-ready";

/**
 * Wallet stack (RainbowKit / wagmi / WalletConnect) stays off the server
 * graph so desk pages do not pull pino/thread-stream into SSR.
 *
 * Until mount, children render without WagmiProvider — anything that calls
 * wagmi / RainbowKit hooks must gate on useWeb3Ready(). Ready flips true
 * only *inside* the lazy provider tree, never during the load gap.
 */
const Web3ProviderLazy = dynamic(
  () =>
    import("@/components/providers/web3-provider").then((m) => m.Web3Provider),
  { ssr: false },
);

export function Web3ProviderClient({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Web3ReadyContext.Provider value={false}>
        {children}
      </Web3ReadyContext.Provider>
    );
  }

  return (
    <Web3ProviderLazy>
      <Web3ReadyContext.Provider value={true}>
        {children}
      </Web3ReadyContext.Provider>
    </Web3ProviderLazy>
  );
}
