"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  injectedWallet,
  metaMaskWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { baseSepolia, hederaTestnet, PRIMARY_CHAIN_ID } from "./chains";

const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ||
  // RainbowKit needs a string; real WC needs a cloud project id.
  "00000000000000000000000000000000";

const hederaRpc =
  process.env.NEXT_PUBLIC_HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
const baseRpc =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

// Skip Coinbase/Base Account connectors — they pull optional @x402 packages
// that break the Next build. MetaMask + WC + injected is enough for Hedera.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [metaMaskWallet, walletConnectWallet, injectedWallet],
    },
  ],
  {
    appName: "Proofwork",
    projectId,
  },
);

/**
 * Hedera testnet first. Base Sepolia stays in the list so we can point
 * NEXT_PUBLIC_CHAIN_ID=84532 without a code change.
 */
export const wagmiConfig = createConfig({
  connectors,
  chains: [hederaTestnet, baseSepolia],
  transports: {
    [hederaTestnet.id]: http(hederaRpc),
    [baseSepolia.id]: http(baseRpc),
  },
  // Client-only provider (dynamic import, ssr:false) — do not SSR connectors.
  ssr: false,
});

export function potAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_BUDGET_POT_ADDRESS?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

export function escrowAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_ESCROW_ADDRESS?.trim();
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as `0x${string}`;
}

export function primaryChainId(): number {
  return PRIMARY_CHAIN_ID === 84532 ? 84532 : 296;
}
