import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";

/** Hedera testnet EVM (Hashio). Primary chain for Mumbai demo. */
export const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: {
    name: "HBAR",
    symbol: "HBAR",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_HEDERA_RPC_URL ??
          "https://testnet.hashio.io/api",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "HashScan",
      url: "https://hashscan.io/testnet",
    },
  },
  testnet: true,
});

/** Kept in the wagmi config so flipping to Base Sepolia is one env away. */
export { baseSepolia };

export const PRIMARY_CHAIN_ID = Number(
  process.env.NEXT_PUBLIC_CHAIN_ID ?? "296",
);

export function hashscanTxUrl(txHash: string, chainId = PRIMARY_CHAIN_ID): string {
  if (chainId === 84532) {
    return `https://sepolia.basescan.org/tx/${txHash}`;
  }
  return `https://hashscan.io/testnet/transaction/${txHash}`;
}
