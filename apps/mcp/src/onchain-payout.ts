import type { Hash, Hex } from "viem";
import { markTaskPayout, getTaskPayout, type PayoutRecord } from "./worker-profiles.js";
import {
  gigEscrowConfigured,
  hashscanTx,
  releaseGigEscrow,
} from "./onchain-escrow.js";
import {
  budgetPotWithdrawAmount,
  potBalanceCoversReward,
  potBalanceShortfallMessage,
  workerNativeTransferValue,
} from "./budget-pot-units.js";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";

const hederaTestnet = defineChain({
  id: 296,
  name: "Hedera Testnet",
  nativeCurrency: { name: "HBAR", symbol: "HBAR", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.HEDERA_RPC_URL ??
          process.env.NEXT_PUBLIC_HEDERA_RPC_URL ??
          "https://testnet.hashio.io/api",
      ],
    },
  },
  blockExplorers: {
    default: { name: "HashScan", url: "https://hashscan.io/testnet" },
  },
  testnet: true,
});

const potAbi = parseAbi([
  "function withdraw(uint256 amount)",
  "function owner() view returns (address)",
  "function balance() view returns (uint256)",
]);

export class PayoutSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutSetupError";
  }
}

function readPayoutKey(): Hex {
  const raw =
    process.env.PAYOUT_PRIVATE_KEY?.trim() ||
    process.env.HEDERA_OPERATOR_EVM_KEY?.trim() ||
    "";
  // Ignore Hedera account DER keys — need a JSON-RPC secp256k1 key.
  if (!raw) {
    throw new PayoutSetupError(
      "PAYOUT_PRIVATE_KEY unset — set a 0x… EVM key (funded on Hedera testnet) to release worker payouts. HEDERA_OPERATOR_KEY (DER) is not enough; use HEDERA_OPERATOR_EVM_KEY or PAYOUT_PRIVATE_KEY.",
    );
  }
  const hex = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  if (!/^0x[a-fA-F0-9]{64}$/.test(hex)) {
    throw new PayoutSetupError(
      "PAYOUT_PRIVATE_KEY must be a 32-byte hex EVM private key (0x + 64 hex).",
    );
  }
  return hex;
}

function potAddress(): Hex | null {
  const raw =
    process.env.BUDGET_POT_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_BUDGET_POT_ADDRESS?.trim() ||
    "";
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as Hex;
}

export { hashscanTx } from "./onchain-escrow.js";

/**
 * Release worker payout on-chain. Prefers GigEscrow.release when configured;
 * otherwise legacy BudgetPot.withdraw + native transfer. Idempotent on taskId.
 */
export async function releaseOnChainPayout(opts: {
  taskId: string;
  to: Hex;
  amountWei: bigint;
}): Promise<PayoutRecord> {
  const prior = getTaskPayout(opts.taskId);
  if (prior) return prior;

  if (opts.amountWei <= 0n) {
    throw new PayoutSetupError("payout amount must be > 0");
  }

  if (gigEscrowConfigured()) {
    const released = await releaseGigEscrow({
      taskId: opts.taskId,
      worker: opts.to,
      amountTinybar: opts.amountWei,
    });
    const row: PayoutRecord = {
      taskId: opts.taskId,
      to: opts.to,
      amountWei: opts.amountWei.toString(),
      txHash: released.txHash,
      at: Date.now(),
    };
    markTaskPayout(row);
    return row;
  }

  const rewardTinybar = opts.amountWei;
  const payoutTxValue = workerNativeTransferValue(rewardTinybar);

  const pk = readPayoutKey();
  const account = privateKeyToAccount(pk);
  const rpc =
    process.env.HEDERA_RPC_URL ??
    process.env.NEXT_PUBLIC_HEDERA_RPC_URL ??
    "https://testnet.hashio.io/api";

  const publicClient = createPublicClient({
    chain: hederaTestnet,
    transport: http(rpc),
  });
  const wallet = createWalletClient({
    account,
    chain: hederaTestnet,
    transport: http(rpc),
  });

  let withdrawTxHash: Hash | undefined;
  const pot = potAddress();
  if (pot) {
    try {
      const owner = await publicClient.readContract({
        address: pot,
        abi: potAbi,
        functionName: "owner",
      });
      if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new PayoutSetupError(
          `PAYOUT_PRIVATE_KEY ${account.address} is not BudgetPot owner ${owner} — cannot withdraw`,
        );
      }
      const potBalanceTinybar = await publicClient.readContract({
        address: pot,
        abi: potAbi,
        functionName: "balance",
      });
      if (!potBalanceCoversReward(potBalanceTinybar, rewardTinybar)) {
        throw new PayoutSetupError(
          potBalanceShortfallMessage(potBalanceTinybar, rewardTinybar),
        );
      }
      const withdrawTinybar = budgetPotWithdrawAmount(rewardTinybar);
      withdrawTxHash = await wallet.writeContract({
        address: pot,
        abi: potAbi,
        functionName: "withdraw",
        args: [withdrawTinybar],
      });
      const wReceipt = await publicClient.waitForTransactionReceipt({
        hash: withdrawTxHash,
      });
      if (wReceipt.status !== "success") {
        throw new PayoutSetupError(`BudgetPot.withdraw reverted (${withdrawTxHash})`);
      }
    } catch (e) {
      if (e instanceof PayoutSetupError) throw e;
      throw new PayoutSetupError(
        e instanceof Error
          ? `BudgetPot.withdraw failed: ${e.message}`
          : "BudgetPot.withdraw failed",
      );
    }
  }

  // Native transfer to worker (from pot owner after withdraw, or hot wallet).
  let txHash: Hash;
  try {
    txHash = await wallet.sendTransaction({
      to: opts.to,
      value: payoutTxValue,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new PayoutSetupError(`worker transfer reverted (${txHash})`);
    }
  } catch (e) {
    if (e instanceof PayoutSetupError) throw e;
    throw new PayoutSetupError(
      e instanceof Error
        ? `worker transfer failed: ${e.message}`
        : "worker transfer failed",
    );
  }

  const row: PayoutRecord = {
    taskId: opts.taskId,
    to: opts.to,
    amountWei: opts.amountWei.toString(),
    txHash,
    withdrawTxHash,
    at: Date.now(),
  };
  markTaskPayout(row);
  return row;
}
