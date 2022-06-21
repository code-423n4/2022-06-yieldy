import {
  ethers,
  deployments,
  getNamedAccounts,
  network,
  upgrades,
} from "hardhat";
import { expect } from "chai";
import { Yieldy } from "../typechain-types/Yieldy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import { cowSettlementAbi } from "../src/abis/cowSettlementAbi";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import {
  LiquidityReserve,
  Staking,
  StakingV2Test,
  YieldyV2Test,
} from "../typechain-types";
import * as constants from "./constants";
import axios from "axios";

describe("Staking", function () {
  let accounts: SignerWithAddress[];
  let rewardToken: Yieldy;
  let staking: Staking;
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let tokeToken: Contract;
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
    const epochDuration = (await staking.epoch()).duration.toNumber();
    await network.provider.send("evm_increaseTime", [epochDuration + 10]);
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
    tokeToken = new ethers.Contract(
      constants.TOKE_TOKEN,
      ERC20.abi,
      accounts[0]
    );
    tokePool = new ethers.Contract(
      constants.TOKE_ADDRESS,
      tokePoolAbi,
      accounts[0]
    );

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardToken = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await rewardToken.deployed();

    const liquidityReserveDeployment = await ethers.getContractFactory(
      "LiquidityReserve"
    );
    liquidityReserve = (await upgrades.deployProxy(liquidityReserveDeployment, [
      "Liquidity Reserve FOX",
      "lrFOX",
      constants.STAKING_TOKEN,
      rewardToken.address,
    ])) as LiquidityReserve;

    const currentBlock = await ethers.provider.getBlockNumber();
    const currentTime = (await ethers.provider.getBlock(currentBlock))
      .timestamp;
    const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

    const stakingDeployment = await ethers.getContractFactory("Staking");
    staking = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      liquidityReserve.address,
      ethers.constants.AddressZero,
      constants.CURVE_POOL,
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

    // Transfer to admin account for STAKING_TOKEN to be easily transferred to other accounts
    const transferAmount = BigNumber.from("9000000000000000");
    const whaleSigner = await ethers.getSigner(constants.STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);
    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    const reserveAmount = "1000000000000000";

    await rewardToken.initializeStakingContract(staking.address); // initialize reward contract
    await stakingToken.approve(
      liquidityReserve.address,
      BigNumber.from(reserveAmount)
    ); // approve initial liquidity amount
    await liquidityReserve.enableLiquidityReserve(staking.address);
    await liquidityReserve.setFee(constants.INSTANT_UNSTAKE_FEE);

    const adminSigner = accounts.find((account) => account.address === admin);

    // add liquidity with lp1
    await stakingToken
      .connect(adminSigner as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await liquidityReserve
      .connect(adminSigner as Signer)
      .addLiquidity(reserveAmount);
    expect(await liquidityReserve.balanceOf(admin)).eq(reserveAmount);
  });

  describe("initialize", function () {
    it("Yieldy and Staking can be upgraded", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(2);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await mineToNextEpoch();

      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.claim(staker1);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(0);

      // stake again after claiming
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // should auto claim the current warmup rewards when staking again
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance stays same due to previous staking amount being claimed
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // staker1 reward balance doubles due to being claimed
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should match stakingAmount since previous balance was claimed
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should be able to stake again with rewards in warmup during same epoch
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance should double
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount.mul(2));

      // staker1 reward balance should stay the same
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should should double
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.mul(2));

      // able to unstake with warmup & wallet balance
      await mineBlocksToNextCycle();

      let coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      // warmUpInfo & rewardToken balance had 2x stakingAmount, should now have 1x staking amount
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // able to unstake with warmup & cooldown & wallet balance
      await stakingStaker1.unstake(stakingAmount.mul(2), false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // warmUpInfo & rewardToken balance should be empty now
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.rebase();

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // upgrade contracts

      const rewardTokenDeployment = await ethers.getContractFactory(
        "YieldyV2Test"
      );
      const rewardTokenV2 = (await upgrades.upgradeProxy(
        rewardToken.address,
        rewardTokenDeployment
      )) as YieldyV2Test;

      const newFunction = await rewardTokenV2.newFunction();
      expect(newFunction).eq(7777777);

      const stakingDeployment = await ethers.getContractFactory(
        "StakingV2Test"
      );
      const StakingV2 = (await upgrades.upgradeProxy(
        staking.address,
        stakingDeployment
      )) as StakingV2Test;

      const newFunctionResult = await StakingV2.newFunction();
      expect(newFunctionResult).eq("123456789");

      // can't claim yet due to cooldown period being 2
      await StakingV2.claimWithdraw(staker1);
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      coolDownInfo = await staking.coolDownInfo(staker1);
      // expect(coolDownInfo.amount).eq(stakingAmount.mul(3)); // TODO: migrate Vesting

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // can claim now
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount.mul(3));

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      // should still have some reward tokens left
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });

    it("Fails when no staking/reward token or staking contract is passed in", async () => {
      const stakingFactory = await ethers.getContractFactory("Staking");

      const currentBlock = await ethers.provider.getBlockNumber();
      const currentTime = (await ethers.provider.getBlock(currentBlock))
        .timestamp;
      const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

      // fail due to bad addresses
      await expect(
        upgrades.deployProxy(stakingFactory, [
          stakingToken.address,
          ethers.constants.AddressZero,
          constants.TOKE_TOKEN,
          constants.TOKE_ADDRESS,
          constants.TOKE_MANAGER,
          constants.TOKE_REWARD,
          liquidityReserve.address,
          ethers.constants.AddressZero,
          ethers.constants.AddressZero,
          constants.EPOCH_DURATION,
          firstEpochEndTime,
        ])
      ).to.be.reverted;
    });
  });

  describe("stake", function () {
    it("User can stake, claim and unstake full amount when warmup period is 0", async () => {
      const { staker1 } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await expect(
        stakingStaker1.functions["stake(uint256)"](0)
      ).to.be.revertedWith("Must have valid amount");
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);
      expect(await rewardToken.totalSupply()).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).to.equal(stakingAmount);
      expect(await rewardToken.totalSupply()).eq(stakingAmount);
    });
    it("Users have to wait for warmup period to claim and cooldown period to withdraw", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(1);
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount;
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // balance should still be zero, until we claim the rewardToken.
      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // fails to claim
      await stakingStaker1.claim(staker1);
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(stakingAmount);

      await mineToNextEpoch();

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      // claim succeeds now
      await stakingStaker1.claim(staker1);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(0);

      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // shouldn't have stakingToken balance
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.claimWithdraw(staker1);

      // epoch hasn't increased yet so claimWithdraw doesn't work yet
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();
      await stakingStaker1.claimWithdraw(staker1);

      // has stakingBalance after withdrawal
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);
      expect(await rewardToken.totalSupply()).eq(0);
    });

    it("Fails to unstake when calling more than what user has in wallet or warmup contract", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      const warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(stakingAmount);
      expect(await rewardToken.balanceOf(staking.address)).to.equal(
        stakingAmount
      );

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // unstake fails due to too incorrect amount
      await expect(
        stakingStaker1.unstake(stakingAmount.add(1), false)
      ).to.be.revertedWith("Insufficient Balance");
    });

    it("Users can unstake using funds from both wallet and warmup", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(stakingAmount);
      expect(await rewardToken.balanceOf(staking.address)).to.equal(
        stakingAmount
      );

      let staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await mineToNextEpoch();
      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      await stakingStaker1.claim(staker1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).to.equal(stakingAmount);

      staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(stakingAmount);

      // unstake will grab rewardTokens from both warmup & wallet
      await stakingStaker1.unstake(transferAmount, false);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(0);
    });

    it("User can stake and unstake half amount without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await mineToNextEpoch();

      // need to rebase to increase epoch number
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      const warmupRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount.div(2), false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // warmUpInfo for staker1 should be 2500
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.div(2));

      // coolDownInfo for staker1 should be 2500
      const coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.div(2));

      const stakingRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(stakingRewardTokenBalance).eq(stakingAmount);
      expect(await rewardToken.totalSupply()).eq(stakingAmount);
    });

    it("User can stake and unstake full amount without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      const warmupRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // no need to call sendWithdrawalRequests if previously mined to next block
      await mineBlocksToNextCycle();

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      const coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      // warmUpInfo for staker1 should have been deleted
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      const stakingTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(stakingTokenBalance).eq(stakingAmount);
    });

    it("Warmup period changing doesn't break stuff", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await staking.setWarmUpPeriod(0);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(0);

      // can't claim because users Claim expiry didn't actually change
      stakingStaker1.claim(staker1);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(0);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // can claim now due to expiry passing
      stakingStaker1.claim(staker1);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });

    it("RequestedWithdrawals are 0 until sendWithdrawalRequests is called", async () => {
      const { staker1 } = await getNamedAccounts();

      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(stakingAmount);
    });

    it("Can instant unstake partial amount with curve", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("1000000000000002");
      const unstakeAmount = transferAmount.div(2);
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      const estimatedTransferAmount = await staking.estimateInstantCurve(
        unstakeAmount
      );

      const slippage = 50; // in bps
      const slippageDiff = unstakeAmount.mul(slippage).div(10000);
      const slippageAmount = unstakeAmount.sub(slippageDiff);
      await stakingStaker1.instantUnstakeCurve(unstakeAmount, slippageAmount);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(unstakeAmount);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(estimatedTransferAmount);
    });

    it("Can instant unstake full amount with curve", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = "1000000000000001";
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      const estimatedTransferAmount = await staking.estimateInstantCurve(
        transferAmount
      );

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await staking.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);

      const slippage = 50; // in bps
      const slippageDiff = totalBalance.mul(slippage).div(10000);
      const slippageAmount = totalBalance.sub(slippageDiff);
      await stakingStaker1.instantUnstakeCurve(totalBalance, slippageAmount);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(estimatedTransferAmount);
    });

    it("Can instant unstake partial amount with liquidity reserve", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000000");
      const unstakeAmount = transferAmount.div(2);
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // can't instantUnstake without reward tokens
      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await staking.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await expect(
        stakingStaker1.instantUnstakeReserve(totalBalance)
      ).to.be.revertedWith("Invalid amount");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.instantUnstakeReserve(unstakeAmount);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(unstakeAmount);

      const amountMinusFee = unstakeAmount.sub(
        unstakeAmount.mul(constants.INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });

    it("Can instant unstake full amount with liquidity reserve", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // can't instantUnstake without reward tokens
      let walletBalance = await rewardToken.balanceOf(staker1);
      let warmUpInfo = await staking.warmUpInfo(staker1);
      let warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      let totalBalance = walletBalance.add(warmUpBalance);
      await expect(
        stakingStaker1.instantUnstakeReserve(totalBalance)
      ).to.be.revertedWith("Invalid amount");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(transferAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      walletBalance = await rewardToken.balanceOf(staker1);
      warmUpInfo = await staking.warmUpInfo(staker1);
      warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      totalBalance = walletBalance.add(warmUpBalance);
      await stakingStaker1.instantUnstakeReserve(totalBalance);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(constants.INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });

    it("Can instant unstake without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      let rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await staking.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingStaker1.instantUnstakeReserve(totalBalance);

      rewardBalance = await rewardToken.balanceOf(staker1);
      expect(rewardBalance).eq(0);

      const amountMinusFee = transferAmount.sub(
        transferAmount.mul(constants.INSTANT_UNSTAKE_FEE).div(10000)
      );
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(amountMinusFee);
    });

    it("User can stake and unstake multiple times with and without claiming", async () => {
      const { staker1 } = await getNamedAccounts();
      await staking.setWarmUpPeriod(1);
      await staking.setCoolDownPeriod(2);

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(staker1, transferAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // warmUpInfo for staker1 should be stakingAmount
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      let warmupRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.claim(staker1);

      let rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(0);

      // stake again after claiming
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // should auto claim the current warmup rewards when staking again
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance stays same due to previous staking amount being claimed
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount);

      // staker1 reward balance doubles due to being claimed
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should match stakingAmount since previous balance was claimed
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should be able to stake again with rewards in warmup during same epoch
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // warmup reward token balance should double
      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(stakingAmount.mul(2));

      // staker1 reward balance should stay the same
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount.mul(2));

      // warmupInfo should should double
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount.mul(2));

      // able to unstake with warmup & wallet balance
      await mineBlocksToNextCycle();
      await mineToNextEpoch();

      let coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      // warmUpInfo & rewardToken balance had 2x stakingAmount, should now have 1x staking amount
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // able to unstake with warmup & cooldown & wallet balance
      await stakingStaker1.unstake(stakingAmount.mul(2), false);

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // cooldown should be 3x stakingAmount
      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      // warmUpInfo & rewardToken balance should be empty now
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(0);

      warmupRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(warmupRewardTokenBalance).eq(coolDownInfo.amount);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.rebase();

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // can't claim yet due to cooldown period being 2
      await stakingStaker1.claimWithdraw(staker1);
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount.mul(3));

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // can claim now
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount.mul(3));

      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(0);

      // should still have some reward tokens left
      rewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalance).eq(stakingAmount);
    });

    it("when un-staking again without claimWithdraw it auto claims withdraw", async () => {
      const { staker1 } = await getNamedAccounts();

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      const unStakingAmount = stakingAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await mineToNextEpoch();
      await stakingStaker1.rebase();

      // no need to call sendWithdrawalRequests if previously mined to next block
      await mineBlocksToNextCycle();

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(unStakingAmount, false);

      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(cooldownRewardTokenBalance).eq(unStakingAmount);

      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.rebase();

      await stakingStaker1.unstake(unStakingAmount, false);

      // rest of unstaking reward goes into cooldown
      cooldownRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(cooldownRewardTokenBalance).eq(unStakingAmount);

      // automatically claims previous cooldown rewards
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(unStakingAmount);
    });

    it("can unstake multiple times and get full amount", async () => {
      const { staker1 } = await getNamedAccounts();

      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("10000");
      const unStakingAmount = stakingAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(unStakingAmount, false);
      await stakingStaker1.unstake(unStakingAmount, false);

      // full amount in cooldown contract
      let cooldownRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(cooldownRewardTokenBalance).eq(stakingAmount);

      // nothing in users wallet
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);

      cooldownRewardTokenBalance = await rewardToken.balanceOf(staking.address);
      expect(cooldownRewardTokenBalance).eq(0);

      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);
    });

    it("unstakeAllFromTokemak allows users to unstake and claim rewards", async () => {
      const { staker1, admin } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("100000");

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await mineBlocksToNextCycle();

      const stakingContractStakingBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractStakingBalance).eq(0);

      // call unstakeAllFromTokemak
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);
      await stakingAdmin.unstakeAllFromTokemak();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // user can still unstake and claim without sendWithdrawalRequest
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // user should now be able to unstake + claim in one action
      await stakingStaker1.unstake(stakingAmount, false);
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);
    });

    it("unstakeAllFromTokemak allows users to unstake and claim rewards with cooldown", async () => {
      const { staker1, admin } = await getNamedAccounts();
      let staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);
      // transfer STAKING_TOKEN to staker 1
      const stakingAmount = BigNumber.from("100000");

      await stakingToken.transfer(staker1, stakingAmount);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await mineBlocksToNextCycle();

      const stakingContractStakingBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractStakingBalance).eq(0);

      // call unstakeAllFromTokemak
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);
      await stakingAdmin.unstakeAllFromTokemak();

      // do rollover
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // user can still unstake and claim without sendWithdrawalRequest
      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(0);

      // user should now be able to unstake + claim in one action
      await stakingStaker1.unstake(stakingAmount, false);
      await stakingStaker1.claimWithdraw(staker1);

      staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount);
    });
  });

  describe("reward", function () {
    it("Reward indexes are set correctly", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("1000000000000000");

      expect(await rewardToken.getIndex()).eq("1000000000000000000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount1 = BigNumber.from("1000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);

      let rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");

      // can't send more than balance
      await expect(
        stakingStaker1.addRewardsForStakers(transferAmount.add(1), true, false)
      ).to.be.reverted;

      await staking.addRewardsForStakers(awardAmount, true, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      // fast forward to after reward block
      await mineToNextEpoch();

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);

      await mineToNextEpoch();

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      expect(rewardTokenBalanceStaker1).eq(stakingAmount1.add(awardAmount));
      expect(await rewardToken.getIndex()).eq("2000000000000000000");
    });

    it("Rewards can be added to contract and rebase rewards users", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const stakingStaker2 = staking.connect(staker2Signer as Signer);

      const stakingAmount1 = BigNumber.from("10000");
      const stakingAmount2 = BigNumber.from("1000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);
      await stakingStaker2.claim(staker2);

      let rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      let rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");

      // can't send more than balance
      await expect(
        stakingStaker1.addRewardsForStakers(transferAmount.add(1), true, false)
      ).to.be.reverted;

      await staking.addRewardsForStakers(awardAmount, true, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // fast forward to after reward block
      await mineToNextEpoch();

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      await mineToNextEpoch();

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(stakingAmount1.add(909));
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2.add(90));
    });

    it("Unstakes correct amounts with rewards", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const stakingStaker2 = staking.connect(staker2Signer as Signer);

      const stakingAmount1 = BigNumber.from("10000");
      const stakingAmount2 = BigNumber.from("1000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

      // claim should move the rewardToken from warmup to the staker
      await stakingStaker1.claim(staker1);
      await stakingStaker2.claim(staker2);

      let rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      let rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // add rewards and trigger rebase, no rebase should occur due to scheduled block
      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("1000");
      await staking.addRewardsForStakers(awardAmount, true, true);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // fast forward to after reward block
      await mineToNextEpoch();

      // call rebase - no change still rewards are issued in a 1 period lagging fashion...
      await staking.rebase();
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      await mineToNextEpoch();

      const newStakingAmount1 = stakingAmount1.add(909);
      const newStakingAmount2 = stakingAmount2.add(90);

      // finally rewards should be issued
      await staking.rebase();
      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(newStakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(newStakingAmount2);

      // unstake with new amounts
      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, newStakingAmount1);
      await stakingStaker1.unstake(newStakingAmount1, false);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, newStakingAmount2);
      await stakingStaker2.unstake(newStakingAmount2, false);

      rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);
      expect(rewardTokenBalanceStaker1).eq(0);
      expect(rewardTokenBalanceStaker2).eq(0);

      const cooldownRewardTokenBalance = await rewardToken.balanceOf(
        staking.address
      );
      expect(cooldownRewardTokenBalance).eq(
        newStakingAmount1.add(newStakingAmount2)
      );
    });

    it("Gives the correct amount of rewards ", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000000000");

      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const stakingStaker2 = staking.connect(staker2Signer as Signer);

      const stakingAmount1 = BigNumber.from("1000");
      const stakingAmount2 = BigNumber.from("10000000000");

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

      const rewardTokenBalanceStaker1 = await rewardToken.balanceOf(staker1);
      const rewardTokenBalanceStaker2 = await rewardToken.balanceOf(staker2);

      expect(rewardTokenBalanceStaker1).eq(stakingAmount1);
      expect(rewardTokenBalanceStaker2).eq(stakingAmount2);

      // call rebase without rewards, no change should occur in balances.
      await staking.rebase();

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let stakingContractBalance = await stakingToken.balanceOf(
        staking.address
      );
      expect(stakingContractBalance).eq(stakingAmount2);

      const withdrawalAmount = await staking.withdrawalAmount();
      expect(withdrawalAmount).eq(stakingAmount2);

      await stakingToken.approve(staking.address, ethers.constants.MaxUint256); // from admin
      const awardAmount = BigNumber.from("100000");
      await staking.addRewardsForStakers(awardAmount, true, true);

      stakingContractBalance = await stakingToken.balanceOf(staking.address);
      expect(stakingContractBalance).eq(stakingAmount2);

      const epoch = await staking.epoch();
      expect(epoch.distribute).eq(awardAmount);
    });
  });

  describe("sendWithdrawalRequest", function () {
    it("requestWithdrawalAmount is correct", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);

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

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();

      await stakingStaker1.sendWithdrawalRequests();

      let stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();

      await stakingStaker2.claimWithdraw(staker2);

      stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1
      );

      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // finally, it goes through
      stakingTokenBalance = await stakingToken.balanceOf(staking.address);
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount1.add(stakingAmount3)
      );
    });
    it("fails if either index isn't increased or batch period hasn't hit", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);

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

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);
      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);
      // initial withdraw request sets lastTokeCycleIndex
      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);
      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });

      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals doesn't change due to not within batch window
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await mineBlocksToNextCycle();

      // sendWithdrawalRequests work now
      await stakingStaker1.sendWithdrawalRequests();

      let stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);

      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // requestedWithdrawals not updated due to cycle index not being updated
      stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2)
      );

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await stakingStaker3.sendWithdrawalRequests();

      // finally, it goes through
      stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        staking.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1.add(stakingAmount2).add(stakingAmount3)
      );
    });
    it("still sends if missed window", async () => {
      const { staker1, staker2 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);

      await stakingToken.transfer(staker1, stakingAmount1);
      await stakingToken.transfer(staker2, stakingAmount2);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await mineBlocksToNextCycle();
      await mineBlocksToNextCycle();

      // get current lastTokeCycleIndex
      const lastCycle = await stakingStaker1.lastTokeCycleIndex();
      // withdraw even though missed window
      await stakingStaker1.sendWithdrawalRequests();
      // lastTokeCycleIndex should but updated
      const nextCycle = await stakingStaker1.lastTokeCycleIndex();

      expect(lastCycle.toNumber()).lessThan(nextCycle.toNumber());

      // next requestedWithdrawals should be
      const stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      const totalStakingAmount = stakingAmount2.add(stakingAmount1);
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        totalStakingAmount
      );

      // both should be able to claim
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);
      await stakingStaker2.claimWithdraw(staker2);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(stakingAmount1);

      const staker2StakingBalance = await stakingToken.balanceOf(staker2);
      expect(staker2StakingBalance).eq(stakingAmount2);
    });
  });

  describe("tokemak", function () {
    // skipping due to order failing sometimes when called in succession
    // tests cow swap order & presign
    it.skip("Trades TOKE to stakingToken on CoW Protocol", async () => {
      const cowSettlement = "0x9008D19f58AAbD9eD0D60971565AA8510560ab41";
      const transferAmount = "76000000000000000000000";

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_TOKEN_WHALE],
      });

      const whaleSigner = await ethers.getSigner(constants.TOKE_TOKEN_WHALE);
      const tokeTokenWhale = tokeToken.connect(whaleSigner);
      await tokeTokenWhale.transfer(staking.address, transferAmount);

      const tokeTokenBalance = await tokeToken.balanceOf(staking.address);
      expect(BigNumber.from(tokeTokenBalance)).gte(
        BigNumber.from(transferAmount)
      );

      const response = await axios.post(
        "https://api.cow.fi/mainnet/api/v1/quote",
        {
          sellToken: constants.TOKE_TOKEN, // constants.TOKE_TOKEN, // address of token sold
          buyToken: constants.STAKING_TOKEN, // constants.STAKING_TOKEN, // address of token bought
          receiver: staking.address, // address that receives proceedings of trade, if zero then user who signed
          validTo: 2281625458, // timestamp until order is valid
          appData:
            "0x0000000000000000000000000000000000000000000000000000000000000000", // extra information
          partiallyFillable: false,
          sellTokenBalance: "erc20",
          buyTokenBalance: "erc20",
          from: staking.address,
          kind: "sell", // sell or buy
          sellAmountBeforeFee: transferAmount, // amount before fee
        }
      );
      expect(response.status).eq(200);

      const orderUid = await axios.post(
        "https://api.cow.fi/mainnet/api/v1/orders",
        {
          ...response.data.quote,
          signingScheme: "presign",
          signature: staking.address,
          from: staking.address,
        }
      );

      const cowSettlementContract = new ethers.Contract(
        cowSettlement,
        cowSettlementAbi,
        accounts[0]
      );
      await expect(staking.preSign(orderUid.data))
        .to.emit(cowSettlementContract, "PreSignature")
        .withArgs(staking.address, orderUid.data, true);
    });
    it("Fails when incorrectly claims/transfer TOKE", async () => {
      const { staker1 } = await getNamedAccounts();

      const v = 28;
      const r =
        "0x0402de926473b79c91b67a49a931108c4c593442ce63193d9c35a9ef12c7d495";
      const s =
        "0x2c3d7cf17e33eb30408a4fb266a812008a35a9e8987e841eecb92504620f55bd";
      let recipient = {
        chainId: 1,
        cycle: 167,
        wallet: staking.address,
        amount: 0,
      };
      // must have amount > 0
      await expect(
        staking.claimFromTokemak(recipient, v, r, s)
      ).to.be.revertedWith("Must enter valid amount");
      recipient = {
        chainId: 1,
        cycle: 167,
        wallet: staking.address,
        amount: 1000,
      };
      // can't actually claim rewards, invalid signature returned from Tokemak
      await expect(
        staking.claimFromTokemak(recipient, v, r, s)
      ).to.be.revertedWith("'ECDSA: invalid signature'");

      // transferToke fails on 0 address
      await expect(staking.transferToke(ethers.constants.AddressZero)).to.be
        .reverted;

      // tries to transfer toke, but to staker1 but none exists
      await staking.transferToke(staker1);
    });
    it("Sends correct amount to affiliate", async () => {
      const { staker2 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("1000000");

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_TOKEN_WHALE],
      });

      const whaleSigner = await ethers.getSigner(constants.TOKE_TOKEN_WHALE);
      const tokeTokenWhale = tokeToken.connect(whaleSigner);
      await tokeTokenWhale.transfer(staking.address, transferAmount);

      let tokeTokenBalance = await tokeToken.balanceOf(staking.address);
      expect(BigNumber.from(tokeTokenBalance).toNumber()).gte(
        transferAmount.toNumber()
      );

      await staking.setAffiliateAddress(staker2);
      await staking.setAffiliateFee(1000);

      const stakingDeployment = await ethers.getContractFactory(
        "StakingV2Test"
      );
      const stakingV2 = (await upgrades.upgradeProxy(
        staking.address,
        stakingDeployment
      )) as StakingV2Test;

      await stakingV2.sendAffiliateFee(transferAmount);
      const fee = transferAmount.mul(await staking.affiliateFee()).div(10000);

      // affiliate balance
      tokeTokenBalance = await tokeToken.balanceOf(staker2);
      expect(tokeTokenBalance).eq(fee);
    });
    it("Staking gives tStakingToken to the Staking contract", async () => {
      const { staker1 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // tokePool should be 0 when no TOKE deposits have been made
      let tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance).eq(0);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // should receive 1:1 tokePool to STAKING_TOKEN
      tokeBalance = await tokePool.balanceOf(stakingStaker1.address);
      expect(tokeBalance).eq(stakingAmount);
    });
    it("Unstaking creates requestedWithdrawals", async () => {
      const { staker1, staker2 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, transferAmount);
      await stakingToken.transfer(staker2, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingAmount1 = transferAmount.div(4);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingAmount2 = transferAmount.div(2);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);
      await stakingStaker2.unstake(stakingAmount2, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      const totalStakingAmount = stakingAmount2.add(stakingAmount1);
      expect(requestedWithdrawals.amount).eq(totalStakingAmount);
    });
    it("Withdrawing gives the user their stakingToken back from Tokemak", async () => {
      const { staker1 } = await getNamedAccounts();

      const stakingAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // user starts out with stakingToken balance
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      await stakingStaker1.claim(staker1);

      // user stakes all of his stakingTokens
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // shouldn't have stakingToken balance
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      await stakingStaker1.claimWithdraw(staker1);

      // has stakingBalance after withdrawal
      stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount);
    });
    it("Can't withdraw without first creating a withdrawRequest", async () => {
      const { staker1 } = await getNamedAccounts();

      const stakingAmount = BigNumber.from("100000");
      await stakingToken.transfer(staker1, stakingAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      await stakingStaker1.claim(staker1);

      const requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      // has no requestedWithdrawals
      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);
      await stakingStaker1.claimWithdraw(staker1);

      // has no stakingBalance after withdrawal
      const stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);
    });
    it("Must wait for new index to send batched withdrawalRequests", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount1);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, transferAmount);

      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount1 after request
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount2);

      await stakingStaker1.unstake(stakingAmount2, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount1 because rollover hasn't happened yet
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount1);

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);

      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestedWithdrawals is set to stakingAmount2 because rollover happened and lastTokeCycleIndex was updated
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      const stakingTokenBalance = await stakingToken.balanceOf(staking.address);

      expect(requestedWithdrawals.amount.add(stakingTokenBalance)).eq(
        stakingAmount2.add(stakingAmount1)
      );
    });
    it("canBatchTransactions is handled appropriately", async () => {
      const { staker1 } = await getNamedAccounts();

      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount.div(2);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // has no requestedWithdrawals or cooldown amounts
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(0);

      const staker1RewardTokenBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardTokenBalance).eq(stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      await stakingStaker1.unstake(stakingAmount, false);

      await stakingStaker1.sendWithdrawalRequests();

      // no withdrawal requests or cooldowns should be created
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );

      expect(requestedWithdrawals.amount).eq(0);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      // requestWithdrawal and cooldown should be created
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);
    });
  });
  describe("admin", () => {
    it("Admin functions work correctly", async () => {
      const { admin, staker1 } = await getNamedAccounts();
      const adminSigner = accounts.find((account) => account.address === admin);
      const stakingAdmin = staking.connect(adminSigner as Signer);

      await stakingAdmin.shouldPauseStaking(true);
      await stakingAdmin.shouldPauseUnstaking(true);
      await stakingAdmin.setCoolDownPeriod(99999999999999);

      await stakingAdmin.setTimeLeftToRequestWithdrawal(10);
      const timeLeftToRequest = await staking.timeLeftToRequestWithdrawal();
      await expect(timeLeftToRequest).eq(10);

      // transfer STAKING_TOKEN to staker 1
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);

      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      const stakingAmount = transferAmount;
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);

      // fails due to staking being paused
      await expect(
        stakingStaker1.functions["stake(uint256)"](stakingAmount)
      ).to.be.revertedWith("Staking is paused");
      await stakingAdmin.shouldPauseStaking(false);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount);

      // fails due to unstaking being paused
      await expect(
        stakingStaker1.unstake(stakingAmount, true)
      ).to.be.revertedWith("Unstaking is paused");

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await staking.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);

      await expect(
        stakingStaker1.instantUnstakeReserve(totalBalance)
      ).to.be.revertedWith("Unstaking is paused");

      await stakingAdmin.shouldPauseInstantUnstaking(true);
      await stakingAdmin.shouldPauseUnstaking(false);

      await expect(
        stakingStaker1.instantUnstakeReserve(totalBalance)
      ).to.be.revertedWith("Unstaking is paused");
      await stakingStaker1.unstake(stakingAmount, true);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      await stakingStaker1.claimWithdraw(staker1);

      // doesn't have staking balance due to cooldown period not expired
      const stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(0);

      let epoch = await staking.epoch();

      expect(epoch.duration).eq(constants.EPOCH_DURATION);

      await stakingAdmin.setEpochDuration(1000);

      epoch = await staking.epoch();

      expect(epoch.duration).eq(1000);

      // test unstakAllFromTokemak

      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(stakingAmount);

      // stake a bunch of stuff
      await stakingToken.transfer(staker1, stakingAmount);
      await stakingTokenStaker1.approve(staking.address, stakingAmount);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // unstake all tfox from tokemak
      const tokeBalance = await tokePool.balanceOf(staking.address);
      await stakingAdmin.unstakeAllFromTokemak();

      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount).eq(tokeBalance);
    });
    it("Emergency exit is working", async () => {
      const { staker1, staker2, staker3 } = await getNamedAccounts();

      const transferAmount = BigNumber.from("100000");
      const stakingAmount1 = transferAmount.div(4);
      const stakingAmount2 = transferAmount.div(2);
      const stakingAmount3 = transferAmount.div(3);
      const totalStaking = stakingAmount1
        .add(stakingAmount2)
        .add(stakingAmount3);

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

      const stakingStaker1 = staking.connect(staker1Signer as Signer);
      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount1);
      await stakingStaker1.claim(staker1);

      const stakingStaker2 = staking.connect(staker2Signer as Signer);
      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, stakingAmount2);
      await stakingStaker2.functions["stake(uint256)"](stakingAmount2);
      await stakingStaker2.claim(staker2);

      const stakingStaker3 = staking.connect(staker3Signer as Signer);
      const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
      await stakingTokenStaker3.approve(staking.address, stakingAmount3);
      await stakingStaker3.functions["stake(uint256)"](stakingAmount3);
      await stakingStaker3.claim(staker3);

      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(staking.address, stakingAmount1);
      await stakingStaker1.unstake(stakingAmount1, false);

      await mineBlocksToNextCycle();
      await stakingStaker1.sendWithdrawalRequests();

      const stakingContractTokenBalance = await stakingToken.balanceOf(
        staking.address
      );
      let requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        stakingAmount1
      );

      await staking.unstakeAllFromTokemak();

      // entire pool being unstaked
      requestedWithdrawals = await tokePool.requestedWithdrawals(
        stakingStaker1.address
      );
      expect(requestedWithdrawals.amount.add(stakingContractTokenBalance)).eq(
        totalStaking
      );

      // can't stake
      await expect(
        stakingStaker1.functions["stake(uint256)"](stakingAmount1)
      ).to.be.revertedWith("Staking is paused");

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await mineBlocksToNextCycle();
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // staker1 doesn't need to unstake since they already did
      await stakingStaker1.claimWithdraw(staker1);
      let stakingTokenBalance = await stakingToken.balanceOf(staker1);
      expect(stakingTokenBalance).eq(stakingAmount1);

      // staker2 can unstake and withdraw
      await rewardToken
        .connect(staker2Signer as Signer)
        .approve(staking.address, stakingAmount2);

      await stakingStaker2.unstake(stakingAmount2, false);
      await stakingStaker2.claimWithdraw(staker2);

      stakingTokenBalance = await stakingToken.balanceOf(staker2);
      expect(stakingTokenBalance).eq(stakingAmount2);

      staking.setCoolDownPeriod(1);

      // staker3 will need to wait for the cooldown period
      await rewardToken
        .connect(staker3Signer as Signer)
        .approve(staking.address, stakingAmount3);
      await stakingStaker3.unstake(stakingAmount3, false);
      await stakingStaker3.claimWithdraw(staker3);

      // no withdrawal due to cooldown
      stakingTokenBalance = await stakingToken.balanceOf(staker3);
      expect(stakingTokenBalance).eq(0);

      // rebase so staker3 can claim
      await mineBlocksToNextCycle();
      await mineToNextEpoch();
      await stakingStaker1.rebase();

      await stakingStaker3.claimWithdraw(staker3);

      stakingTokenBalance = await stakingToken.balanceOf(staker3);
      expect(stakingTokenBalance).eq(stakingAmount3);
    });
  });
});
