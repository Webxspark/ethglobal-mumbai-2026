import {
  createPublicClient,
  createWalletClient,
  http,
  padHex,
  parseAbi,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { budgetPotWithdrawAmount, potBalanceCoversReward } from "./budget-pot-units.js";
import { PayoutSetupError } from "./onchain-payout.js";

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

const gigEscrowAbi = parseAbi([
  "function lock(bytes32 taskId, uint256 amount)",
  "function release(bytes32 taskId, address worker)",
  "function refund(bytes32 taskId)",
  "function locked(bytes32 taskId) view returns (uint256)",
]);

const potAbi = parseAbi(["function balance() view returns (uint256)"]);

export function gigEscrowConfigured(): boolean {
  return Boolean(gigEscrowAddress() && potAddress());
}

function readOperatorKey(): Hex {
  const raw =
    process.env.PAYOUT_PRIVATE_KEY?.trim() ||
    process.env.HEDERA_OPERATOR_EVM_KEY?.trim() ||
    "";
  if (!raw) {
    throw new PayoutSetupError(
      "PAYOUT_PRIVATE_KEY unset — set operator EVM key for GigEscrow lock/release/refund",
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

export function potAddress(): Hex | null {
  const raw =
    process.env.BUDGET_POT_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_BUDGET_POT_ADDRESS?.trim() ||
    "";
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as Hex;
}

export function gigEscrowAddress(): Hex | null {
  const raw =
    process.env.GIG_ESCROW_ADDRESS?.trim() ||
    process.env.NEXT_PUBLIC_GIG_ESCROW_ADDRESS?.trim() ||
    "";
  if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) return null;
  return raw as Hex;
}

export function taskIdToBytes32(taskId: string): Hex {
  const hex = (taskId.startsWith("0x") ? taskId : `0x${taskId}`) as Hex;
  if (!/^0x[a-fA-F0-9]{40}$/.test(hex)) {
    throw new PayoutSetupError(`taskId must be 0x + 20-byte hex, got ${taskId}`);
  }
  return padHex(hex, { size: 32 });
}

function clients() {
  const pk = readOperatorKey();
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
  return { publicClient, wallet, account };
}

export function hashscanTx(txHash: string): string {
  return `https://hashscan.io/testnet/transaction/${txHash}`;
}

export async function lockGigEscrow(opts: {
  taskId: string;
  amountTinybar: bigint;
}): Promise<{ txHash: Hash; explorerUrl: string }> {
  const escrow = gigEscrowAddress();
  const pot = potAddress();
  if (!escrow || !pot) {
    throw new PayoutSetupError(
      "GIG_ESCROW_ADDRESS and BUDGET_POT_ADDRESS required for on-chain lock",
    );
  }
  if (opts.amountTinybar <= 0n) {
    throw new PayoutSetupError("lock amount must be > 0");
  }

  const { publicClient, wallet } = clients();
  const potBalance = await publicClient.readContract({
    address: pot,
    abi: potAbi,
    functionName: "balance",
  });
  const lockAmount = budgetPotWithdrawAmount(opts.amountTinybar);
  if (!potBalanceCoversReward(potBalance, lockAmount)) {
    throw new PayoutSetupError(
      `BudgetPot on-chain balance ${potBalance} tinybar < reward ${lockAmount} tinybar`,
    );
  }

  const taskBytes32 = taskIdToBytes32(opts.taskId);
  let txHash: Hash;
  try {
    txHash = await wallet.writeContract({
      address: escrow,
      abi: gigEscrowAbi,
      functionName: "lock",
      args: [taskBytes32, lockAmount],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new PayoutSetupError(`GigEscrow.lock reverted (${txHash})`);
    }
  } catch (e) {
    if (e instanceof PayoutSetupError) throw e;
    throw new PayoutSetupError(
      e instanceof Error ? `GigEscrow.lock failed: ${e.message}` : "GigEscrow.lock failed",
    );
  }
  return { txHash, explorerUrl: hashscanTx(txHash) };
}

export async function releaseGigEscrow(opts: {
  taskId: string;
  worker: Hex;
  amountTinybar: bigint;
}): Promise<{ txHash: Hash; explorerUrl: string }> {
  const escrow = gigEscrowAddress();
  if (!escrow) {
    throw new PayoutSetupError("GIG_ESCROW_ADDRESS unset");
  }
  if (opts.amountTinybar <= 0n) {
    throw new PayoutSetupError("release amount must be > 0");
  }

  const { publicClient, wallet } = clients();
  const taskBytes32 = taskIdToBytes32(opts.taskId);

  const locked = await publicClient.readContract({
    address: escrow,
    abi: gigEscrowAbi,
    functionName: "locked",
    args: [taskBytes32],
  });
  const expect = budgetPotWithdrawAmount(opts.amountTinybar);
  if (locked !== expect) {
    throw new PayoutSetupError(
      `GigEscrow locked ${locked} tinybar != reward ${expect} tinybar for task`,
    );
  }

  let txHash: Hash;
  try {
    txHash = await wallet.writeContract({
      address: escrow,
      abi: gigEscrowAbi,
      functionName: "release",
      args: [taskBytes32, opts.worker],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new PayoutSetupError(`GigEscrow.release reverted (${txHash})`);
    }
  } catch (e) {
    if (e instanceof PayoutSetupError) throw e;
    throw new PayoutSetupError(
      e instanceof Error
        ? `GigEscrow.release failed: ${e.message}`
        : "GigEscrow.release failed",
    );
  }
  return { txHash, explorerUrl: hashscanTx(txHash) };
}

export async function refundGigEscrow(taskId: string): Promise<{ txHash: Hash; explorerUrl: string } | null> {
  const escrow = gigEscrowAddress();
  if (!escrow) return null;

  const { publicClient, wallet } = clients();
  const taskBytes32 = taskIdToBytes32(taskId);
  const locked = await publicClient.readContract({
    address: escrow,
    abi: gigEscrowAbi,
    functionName: "locked",
    args: [taskBytes32],
  });
  if (locked === 0n) return null;

  let txHash: Hash;
  try {
    txHash = await wallet.writeContract({
      address: escrow,
      abi: gigEscrowAbi,
      functionName: "refund",
      args: [taskBytes32],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      throw new PayoutSetupError(`GigEscrow.refund reverted (${txHash})`);
    }
  } catch (e) {
    if (e instanceof PayoutSetupError) throw e;
    throw new PayoutSetupError(
      e instanceof Error ? `GigEscrow.refund failed: ${e.message}` : "GigEscrow.refund failed",
    );
  }
  return { txHash, explorerUrl: hashscanTx(txHash) };
}
