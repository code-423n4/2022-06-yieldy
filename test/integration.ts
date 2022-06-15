import {
  ethers,
  deployments,
  getNamedAccounts,
  network,
  upgrades,
} from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve, Staking, Yieldy } from "../typechain-types";
import * as constants from "./constants";

describe("Integration", function () {
  let accounts: SignerWithAddress[];
  let yieldy: Yieldy;
  let staking: Staking;
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let tokePool: Contract;
  let tokeManager: Contract;

  // skips EVM time to the next TOKE and epoch cycle
  async function mineBlocksToNextCycle() {
    const epoch = await staking.epoch();
    const cycleDuration = await tokeManager.getCycleDuration();
    const cycleStart = await tokeManager.getCurrentCycle();
    const tokeEndTime = BigNumber.from(cycleStart).add(cycleDuration);
    const duration =
      tokeEndTime < epoch.endTime ? epoch.duration : cycleDuration;
    await network.provider.send("evm_increaseTime", [Number(duration) + 10]);
    await network.provider.send("hardhat_mine");
  }

  // skips EVM time equal to epoch duration
  async function mineToNextEpoch() {
    const epochLength = (await staking.epoch()).duration.toNumber();
    await network.provider.send("evm_increaseTime", [epochLength + 10]);
    await network.provider.send("hardhat_mine");
  }

  beforeEach(async () => {
    const { admin } = await getNamedAccounts();

    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_URL,
            blockNumber: constants.BLOCK_NUMBER,
          },
        },
      ],
    });

    await deployments.fixture();
    accounts = await ethers.getSigners();
    stakingToken = new ethers.Contract(
      constants.STAKING_TOKEN,
      ERC20.abi,
      accounts[0]
    );
    tokePool = new ethers.Contract(
      constants.TOKE_ADDRESS,
      tokePoolAbi,
      accounts[0]
    );

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    yieldy = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await yieldy.deployed();

    const liquidityReserveDeployment = await ethers.getContractFactory(
      "LiquidityReserve"
    );
    liquidityReserve = (await upgrades.deployProxy(liquidityReserveDeployment, [
      "Liquidity Reserve FOX",
      "lrFOX",
      constants.STAKING_TOKEN,
      yieldy.address,
    ])) as LiquidityReserve;

    const currentBlock = await ethers.provider.getBlockNumber();
    const currentTime = (await ethers.provider.getBlock(currentBlock))
      .timestamp;
    const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

    const stakingDeployment = await ethers.getContractFactory("Staking");
    staking = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      yieldy.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      liquidityReserve.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      constants.EPOCH_DURATION,
      firstEpochEndTime,
    ])) as Staking;

    const tokeManagerAddress = await tokePool.manager();
    tokeManager = new ethers.Contract(
      tokeManagerAddress,
      tokeManagerAbi,
      accounts[0]
    );

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.STAKING_TOKEN_WHALE],
    });

    // Transfer to admin account for constants.STAKING_TOKEN to be easily transferred to other accounts
    const transferAmount = BigNumber.from("9000000000000000");
    const whaleSigner = await ethers.getSigner(constants.STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);
    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    await stakingToken.approve(
      liquidityReserve.address,
      BigNumber.from("1000000000000000")
    ); // approve initial liquidity amount

    await liquidityReserve.setFee(constants.INSTANT_UNSTAKE_FEE);

    await liquidityReserve.enableLiquidityReserve(staking.address);

    // add liquidity with lp1
    const reserveAmount = "999999999999000";
    const adminSigner = accounts.find((account) => account.address === admin);

    await stakingToken
      .connect(adminSigner as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await liquidityReserve
      .connect(adminSigner as Signer)
      .addLiquidity(reserveAmount);
    expect(await liquidityReserve.balanceOf(admin)).eq(reserveAmount);

    await yieldy.initializeStakingContract(staking.address); // initialize reward contract
  });

  it("Should do everything", async () => {
    const {
      staker1,
      staker2,
      staker3,
      liquidityProvider1,
      liquidityProvider2,
      liquidityProvider3,
    } = await getNamedAccounts();
    await staking.setCoolDownPeriod(1);
    await staking.setWarmUpPeriod(1);

    const stakingAmount1 = BigNumber.from("80000000000000");
    const stakingAmount2 = BigNumber.from("60000000000000");
    const stakingAmount3 = BigNumber.from("20000000000000");
    const liquidityAmount1 = BigNumber.from("100000000");
    const liquidityAmount2 = BigNumber.from("888888888888888");
    const liquidityAmount3 = BigNumber.from("777777777777778");
    const awardAmount = BigNumber.from("22222222222222");

    // fund addresses with stakingTokens
    await stakingToken.transfer(liquidityProvider1, liquidityAmount1);
    await stakingToken.transfer(liquidityProvider2, liquidityAmount2);
    await stakingToken.transfer(liquidityProvider3, liquidityAmount3);
    await stakingToken.transfer(staker1, stakingAmount1);
    await stakingToken.transfer(staker2, stakingAmount2);
    await stakingToken.transfer(staker3, stakingAmount3);

    const staker1Signer = accounts.find(
      (account) => account.address === staker1
    );
    const staker2Signer = accounts.find(
      (account) => account.address === staker2
    );
    const staker3Signer = accounts.find(
      (account) => account.address === staker3
    );
    const liquidityProvider1Signer = accounts.find(
      (account) => account.address === liquidityProvider1
    );
    const liquidityProvider2Signer = accounts.find(
      (account) => account.address === liquidityProvider2
    );
    const liquidityProvider3Signer = accounts.find(
      (account) => account.address === liquidityProvider3
    );

    // approvals
    await stakingToken.approve(staking.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider1Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider2Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await stakingToken
      .connect(liquidityProvider3Signer as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);
    await yieldy
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    await yieldy
      .connect(staker2Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    await yieldy
      .connect(staker3Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);

    const stakingStaker1 = staking.connect(staker1Signer as Signer);
    const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
    await stakingTokenStaker1.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    const stakingStaker2 = staking.connect(staker2Signer as Signer);
    const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
    await stakingTokenStaker2.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    const stakingStaker3 = staking.connect(staker3Signer as Signer);
    const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
    await stakingTokenStaker3.approve(
      staking.address,
      ethers.constants.MaxUint256
    );

    // stake with staker1
    await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
    let warmUpInfo = await staking.warmUpInfo(staker1);
    expect(warmUpInfo.amount).eq(stakingAmount1);
    let warmupRewardTokenBalance = await yieldy.balanceOf(staking.address);
    expect(warmupRewardTokenBalance).eq(stakingAmount1);

    // add liquidity with lp1
    await liquidityReserve
      .connect(liquidityProvider1Signer as Signer)
      .addLiquidity(liquidityAmount1);
    expect(await liquidityReserve.balanceOf(liquidityProvider1)).eq(
      liquidityAmount1
    );

    // stake with staker 2
    await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
    warmUpInfo = await staking.warmUpInfo(staker2);
    expect(warmUpInfo.amount).eq(stakingAmount2);
    warmupRewardTokenBalance = await yieldy.balanceOf(staking.address);
    expect(warmupRewardTokenBalance).eq(stakingAmount2.add(stakingAmount1));

    // add liquidity twice with lp2
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .addLiquidity(liquidityAmount2.div(2));
    expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
      liquidityAmount2.div(2)
    );
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .addLiquidity(liquidityAmount2.div(2));
    expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
      liquidityAmount2
    );

    // add rewards
    await staking.addRewardsForStakers(awardAmount, true, true);

    // rebase
    await mineToNextEpoch();
    await staking.rebase();

    await mineToNextEpoch();
    await staking.rebase();

    // instantUnstake with staker1
    await yieldy
      .connect(staker1Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    let walletBalance = await yieldy.balanceOf(staker1);
    warmUpInfo = await staking.warmUpInfo(staker1);
    let warmUpBalance = await yieldy.tokenBalanceForCredits(warmUpInfo.credits);
    let totalBalance = walletBalance.add(warmUpBalance);

    await stakingStaker1.instantUnstakeReserve(totalBalance);
    const rewardBalanceStaker1 = await yieldy.balanceOf(staker1);
    expect(rewardBalanceStaker1).eq(0);
    const stakingBalanceStaker1 = await stakingToken.balanceOf(staker1);
    expect(stakingBalanceStaker1).eq(74158730158730);

    // stake with staker3
    await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3);

    // claim and unstake with staker2
    await stakingStaker2.claim(staker2);
    const rewardBalanceStaker2 = await yieldy.balanceOf(staker2);
    await stakingStaker2.unstake(rewardBalanceStaker2, true);
    let coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(rewardBalanceStaker2);

    // check warmup is correct after unstake
    warmUpInfo = await staking.warmUpInfo(staker3);
    expect(warmUpInfo.amount).eq(stakingAmount3); // staker3 didn't get rewards because they staked after
    const warmUpStaker3Reward = await yieldy.tokenBalanceForCredits(
      warmUpInfo.credits
    );

    // unstake with staker3
    await stakingStaker3.unstake(warmUpStaker3Reward, true);

    // add another set of rewards with belong to no one due to all FOXy being locked in cooldown
    await staking.addRewardsForStakers(awardAmount, true, true);

    // rebase
    await mineToNextEpoch();
    await staking.rebase();

    await mineToNextEpoch();
    await staking.rebase();

    // complete rollover & send withdraw requests to read withdraw for
    // staker2 & staker3 & liquidity reserve contract
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.TOKE_OWNER],
    });
    const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
    const tokeManagerOwner = tokeManager.connect(tokeSigner);
    await mineBlocksToNextCycle();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
    await mineBlocksToNextCycle();
    await stakingStaker1.sendWithdrawalRequests();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

    let stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(0);
    let rewardBalance = await yieldy.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(await yieldy.tokenBalanceForCredits(coolDownInfo.credits)).eq(
      78002322880370
    );

    // remove liquidity with lp1 + rewards from instantUnstake
    await liquidityReserve
      .connect(liquidityProvider1Signer as Signer)
      .removeLiquidity(liquidityAmount1);
    let lpStakingBalance = await stakingToken.balanceOf(liquidityProvider1);
    expect(lpStakingBalance).eq(100981512);

    // remove liquidity with lp2 + rewards from instantUnstake
    await liquidityReserve
      .connect(liquidityProvider2Signer as Signer)
      .removeLiquidity(liquidityAmount2);
    lpStakingBalance = await stakingToken.balanceOf(liquidityProvider2);
    expect(lpStakingBalance).eq(897613444916262);

    // rebase
    await mineToNextEpoch();
    await staking.rebase();

    await mineToNextEpoch();
    await staking.rebase();

    // stake with lp2
    await stakingToken
      .connect(liquidityProvider2Signer as Signer)
      .approve(staking.address, ethers.constants.MaxUint256);
    const stakingLiquidityProvider2 = staking.connect(
      liquidityProvider2Signer as Signer
    );
    await stakingLiquidityProvider2.functions["stake(uint256)"](
      897613444916262
    );
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    let warmUpLP2Reward = await yieldy.tokenBalanceForCredits(
      warmUpInfo.credits
    );
    expect(warmUpLP2Reward).eq(897613444916262);

    // claim with staker2
    await stakingStaker2.claimWithdraw(staker2);
    stakingBalance = await stakingToken.balanceOf(staker2);
    expect(stakingBalance).eq(69523809523809); // stakingAmount2 + rewards
    expect(stakingBalance).eq(coolDownInfo.amount);
    rewardBalance = await yieldy.balanceOf(staker2);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker2);
    expect(coolDownInfo.amount).eq(0);

    // claim with staker3
    await stakingStaker3.claimWithdraw(staker3);
    stakingBalance = await stakingToken.balanceOf(staker3);
    expect(stakingBalance).eq(stakingAmount3); // staker3 never got rewards because they staked after rewards and unstaked before next rewards
    rewardBalance = await yieldy.balanceOf(staker3);
    expect(rewardBalance).eq(0);
    coolDownInfo = await staking.coolDownInfo(staker3);
    expect(coolDownInfo.amount).eq(0);

    coolDownInfo = await staking.coolDownInfo(liquidityReserve.address);
    expect(await yieldy.tokenBalanceForCredits(coolDownInfo.credits)).eq(0);

    // add rewards for a third time.  This time liquidityProvider2 should full amount for last two rebases
    // due to no circulating supply outside of cooldown when second reward rebase happened
    // rewardTokens in cooldown does not generate rewards
    await staking.addRewardsForStakers(awardAmount, true, false);

    // rebase
    await mineToNextEpoch();
    await staking.rebase();

    await mineToNextEpoch();
    await staking.rebase();

    // complete rollover to increase tokeIndex
    await mineBlocksToNextCycle();
    await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

    // claimWithdraw from liquidityProvider2
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    warmUpLP2Reward = await yieldy.tokenBalanceForCredits(warmUpInfo.credits);
    expect(warmUpLP2Reward).eq(942057889360702);
    await staking.claimWithdraw(liquidityReserve.address);

    // instantUnstake with liquidityProvider2
    walletBalance = await yieldy.balanceOf(liquidityProvider2);
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    warmUpBalance = await yieldy.tokenBalanceForCredits(warmUpInfo.credits);
    totalBalance = walletBalance.add(warmUpBalance);
    await stakingLiquidityProvider2.instantUnstakeReserve(totalBalance);
    warmUpInfo = await staking.warmUpInfo(liquidityProvider2);
    warmUpLP2Reward = await yieldy.tokenBalanceForCredits(warmUpInfo.credits);
    expect(warmUpLP2Reward).eq(0);
    const stakingBalanceLP2 = await stakingToken.balanceOf(liquidityProvider2);
    expect(stakingBalanceLP2).eq(753646311488562); // 80% of 942057889360702
  });
});
