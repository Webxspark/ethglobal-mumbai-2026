"use client";

import { useState } from "react";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig, primaryChainId } from "@/lib/wagmi/config";
import { baseSepolia, hederaTestnet } from "@/lib/wagmi/chains";
import "@rainbow-me/rainbowkit/styles.css";

const initialChain =
  primaryChainId() === 84532 ? baseSepolia : hederaTestnet;

/** RainbowKit + wagmi — import only from the client-only dynamic wrapper. */
export function Web3Provider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={initialChain}
          theme={lightTheme({
            accentColor: "#111111",
            accentColorForeground: "#ffffff",
            borderRadius: "medium",
            fontStack: "system",
          })}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
