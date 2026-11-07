import { weibarFromTinybar } from "@proofwork/shared";

/**
 * Hedera EVM: values from contract storage / view calls (BudgetPot.balance(),
 * withdraw(uint256) args, internal accounting) are **tinybar** (8 decimals).
 * Only JSON-RPC tx `value` / `eth_getBalance` use **weibar** (×10¹⁰).
 */

export function potBalanceCoversReward(
  potBalanceTinybar: bigint,
  rewardTinybar: bigint,
): boolean {
  return potBalanceTinybar >= rewardTinybar;
}

export function potBalanceShortfallMessage(
  potBalanceTinybar: bigint,
  rewardTinybar: bigint,
): string {
  const rewardWeibar = weibarFromTinybar(rewardTinybar);
  return (
    `BudgetPot balance ${potBalanceTinybar} tinybar < reward ${rewardTinybar} tinybar ` +
    `(worker native transfer needs ${rewardWeibar} weibar)`
  );
}

/** Amount argument for BudgetPot.withdraw on Hedera — tinybar, not weibar. */
export function budgetPotWithdrawAmount(rewardTinybar: bigint): bigint {
  return rewardTinybar;
}

/** Value for wallet.sendTransaction after withdraw — JSON-RPC weibar. */
export function workerNativeTransferValue(rewardTinybar: bigint): bigint {
  return weibarFromTinybar(rewardTinybar);
}
