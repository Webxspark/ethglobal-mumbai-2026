import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { weibarFromTinybar } from "@proofwork/shared";
import {
  budgetPotWithdrawAmount,
  potBalanceCoversReward,
  potBalanceShortfallMessage,
  workerNativeTransferValue,
} from "./budget-pot-units.js";

/** Reported live: 11.01 HBAR pot vs 0.5 HBAR release. */
const POT_TINYBAR = 1_101_000_000n;
const REWARD_TINYBAR = 50_000_000n;
const REWARD_WEIBAR = 500_000_000_000_000_000n;

describe("BudgetPot on-chain units (Hedera)", () => {
  it("0.5 HBAR reward fits 11.01 HBAR pot when both are tinybar", () => {
    assert.equal(potBalanceCoversReward(POT_TINYBAR, REWARD_TINYBAR), true);
    assert.equal(budgetPotWithdrawAmount(REWARD_TINYBAR), REWARD_TINYBAR);
    assert.equal(workerNativeTransferValue(REWARD_TINYBAR), REWARD_WEIBAR);
  });

  it("fails the old bug: pot tinybar compared to reward at weibar scale", () => {
    const rewardAsWeibarUnits = weibarFromTinybar(REWARD_TINYBAR);
    assert.equal(potBalanceCoversReward(POT_TINYBAR, REWARD_TINYBAR), true);
    assert.equal(potBalanceCoversReward(POT_TINYBAR, rewardAsWeibarUnits), false);
    const msg = potBalanceShortfallMessage(POT_TINYBAR, REWARD_TINYBAR);
    assert.match(msg, /1101000000 tinybar < reward 50000000 tinybar/);
    assert.match(msg, /worker native transfer needs 500000000000000000 weibar/);
  });
});
