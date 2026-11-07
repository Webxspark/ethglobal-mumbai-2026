import { createPublicClient, http, type Hash, type Hex } from "viem";
import { hederaTestnet, baseSepolia } from "@/lib/wagmi/chains";
import {
  matchFundTx,
  type FundCheckFail,
  type FundCheckOk,
} from "./match-fund";

export type { FundCheckFail, FundCheckOk, FundCheckInput, FundExpect } from "./match-fund";
export { matchFundTx } from "./match-fund";

function rpcUrl(chainId: number): string {
  if (chainId === 84532) {
    return (
      process.env.BASE_SEPOLIA_RPC_URL ??
      process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ??
      "https://sepolia.base.org"
    );
  }
  return (
    process.env.HEDERA_RPC_URL ??
    process.env.NEXT_PUBLIC_HEDERA_RPC_URL ??
    "https://testnet.hashio.io/api"
  );
}

function chainFor(chainId: number) {
  return chainId === 84532 ? baseSepolia : hederaTestnet;
}

export function makeFundClient(chainId = 296) {
  return createPublicClient({
    chain: chainFor(chainId),
    transport: http(rpcUrl(chainId)),
  });
}

export async function verifyFundTxOnChain(opts: {
  txHash: Hash;
  expectedTo: Hex;
  expectedFrom?: Hex;
  minValueWei: bigint;
  chainId?: number;
}): Promise<FundCheckOk | FundCheckFail> {
  const client = makeFundClient(opts.chainId ?? 296);

  try {
    const tx = await client.getTransaction({ hash: opts.txHash });
    const receipt = await client.getTransactionReceipt({ hash: opts.txHash });
    return matchFundTx(
      {
        from: tx.from,
        to: tx.to,
        value: tx.value,
        status: receipt.status,
      },
      {
        expectedTo: opts.expectedTo,
        expectedFrom: opts.expectedFrom,
        minValueWei: opts.minValueWei,
      },
    );
  } catch (e) {
    return {
      ok: false,
      reason:
        e instanceof Error
          ? `rpc lookup failed: ${e.message}`
          : "rpc lookup failed",
    };
  }
}
