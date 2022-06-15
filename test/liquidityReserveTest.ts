import { ethers, getNamedAccounts, network, upgrades } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import {
  Yieldy,
  LiquidityReserve,
  Staking,
  LiquidityReserveV2Test,
} from "../typechain-types";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";
import { tokeManagerAbi } from "../src/abis/tokeManagerAbi";
import * as constants from "./constants";

describe("Liquidity Reserve", function () {
  let accounts: SignerWithAddress[];
  let liquidityReserve: LiquidityReserve;
  let stakingToken: Contract;
  let stakingContract: Staking;
  let rewardToken: Contract;
  let tokeManager: Contract;
  let tokePool: Contract;

  // skips EVM time to the next TOKE and epoch cycle
  async function mineBlocksToNextCycle() {
    const epoch = await stakingContract.epoch();
    const cycleDuration = await tokeManager.getCycleDuration();
    const cyceleStart = await tokeManager.getCurrentCycle();
    const tokeEndTime = BigNumber.from(cyceleStart).add(cycleDuration);
    const duration =
      tokeEndTime < epoch.endTime ? epoch.duration : cycleDuration;
    await network.provider.send("evm_increaseTime", [Number(duration) + 10]);
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

    accounts = await ethers.getSigners();

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardToken = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await rewardToken.deployed();

    const currentBlock = await ethers.provider.getBlockNumber();
    const currentTime = (await ethers.provider.getBlock(currentBlock))
      .timestamp;
    const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

    stakingToken = new ethers.Contract(
      constants.STAKING_TOKEN,
      ERC20.abi,
      accounts[0]
    );

    const liquidityReserveDeployment = await ethers.getContractFactory(
      "LiquidityReserve"
    );
    liquidityReserve = (await upgrades.deployProxy(liquidityReserveDeployment, [
      "Liquidity Reserve FOX",
      "lrFOX",
      constants.STAKING_TOKEN,
      rewardToken.address,
    ])) as LiquidityReserve;

    const stakingDeployment = await ethers.getContractFactory("Staking");
    stakingContract = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken.address,
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

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.STAKING_TOKEN_WHALE],
    });

    const transferAmount = BigNumber.from("9000000000000000");
    const whaleSigner = await ethers.getSigner(constants.STAKING_TOKEN_WHALE);
    const stakingTokenWhale = stakingToken.connect(whaleSigner);
    await stakingTokenWhale.transfer(admin, transferAmount);
    const stakingTokenBalance = await stakingToken.balanceOf(admin);

    expect(BigNumber.from(stakingTokenBalance).toNumber()).gte(
      transferAmount.toNumber()
    );

    await liquidityReserve.setFee(constants.INSTANT_UNSTAKE_FEE);
    await rewardToken.initializeStakingContract(stakingContract.address); // initialize reward contract

    await stakingToken.approve(
      liquidityReserve.address,
      constants.INITIAL_LR_BALANCE
    ); // approve initial liquidity amount
    await liquidityReserve.enableLiquidityReserve(stakingContract.address);

    const adminSigner = accounts.find((account) => account.address === admin);

    // add liquidity with lp1
    const reserveAmount = "999999999999000";

    await stakingToken
      .connect(adminSigner as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await liquidityReserve
      .connect(adminSigner as Signer)
      .addLiquidity(reserveAmount);
    expect(await liquidityReserve.balanceOf(admin)).eq(reserveAmount);

    tokePool = new ethers.Contract(
      constants.TOKE_ADDRESS,
      tokePoolAbi,
      accounts[0]
    );
    const tokeManagerAddress = await tokePool.manager();
    tokeManager = new ethers.Contract(
      tokeManagerAddress,
      tokeManagerAbi,
      accounts[0]
    );
  });

  describe("deposit & withdraw", function () {
    it("Should upgrade liquidity reserve contract", async () => {
      const { daoTreasury, staker1, liquidityProvider1 } =
        await getNamedAccounts();

      const transferAmount = BigNumber.from("100000000000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(daoTreasury, transferAmount);
      await stakingToken.transfer(liquidityProvider1, stakingAmount);

      // add liquidity with daoTreasury
      let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(transferAmount);

      let daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(0);

      const daoTreasurySigner = accounts.find(
        (account) => account.address === daoTreasury
      );
      const liquidityReserveDao = liquidityReserve.connect(
        daoTreasurySigner as Signer
      );
      const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);

      await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
      await liquidityReserveDao.addLiquidity(transferAmount);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(0);

      daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(transferAmount);

      // add liquidity with liquidityProvider1
      const liquidityProvider1Signer = accounts.find(
        (account) => account.address === liquidityProvider1
      );
      const liquidityReserveLiquidityProvider = liquidityReserve.connect(
        liquidityProvider1Signer as Signer
      );
      const stakingTokenLiquidityProvider = stakingToken.connect(
        liquidityProvider1Signer as Signer
      );

      await stakingTokenLiquidityProvider.approve(
        liquidityReserve.address,
        stakingAmount
      );
      await liquidityReserveLiquidityProvider.addLiquidity(stakingAmount);

      let lp1StakingBalance = await stakingToken.balanceOf(liquidityProvider1);
      expect(lp1StakingBalance).eq(0);

      let lp1LiquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(lp1LiquidityReserveBalance).eq(stakingAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, stakingAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // stake stakingToken to get rewardToken
      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );

      await stakingTokenStaker1.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker1.functions["stake(uint256)"](stakingAmount);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      const fee = await liquidityReserve.fee();

      // upgrade liquidity reserve contract

      const lrDeployment = await ethers.getContractFactory(
        "LiquidityReserveV2Test"
      );
      const LiquidityReserveV2 = (await upgrades.upgradeProxy(
        liquidityReserve.address,
        lrDeployment
      )) as LiquidityReserveV2Test;

      const newFunctionResult = await LiquidityReserveV2.newFunction();
      expect(newFunctionResult).eq("987654321");

      // instant unstake with staker1
      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(
        LiquidityReserveV2.address,
        transferAmount
      );
      await rewardTokenStaker1.approve(stakingContract.address, transferAmount);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await stakingContract.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker1.instantUnstakeReserve(totalBalance);

      const feeAmount = stakingAmount.mul(fee).div(10000);
      const amountMinusFee = stakingAmount.sub(feeAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(amountMinusFee);

      // withdraw and check liquidityProvider1
      lp1LiquidityReserveBalance = await LiquidityReserveV2.balanceOf(
        liquidityProvider1
      );

      // withdraw with liquidityProvider1 && daoTreasury
      await liquidityReserveLiquidityProvider.removeLiquidity(
        lp1LiquidityReserveBalance
      );

      lp1StakingBalance = await stakingToken.balanceOf(liquidityProvider1);
      expect(lp1StakingBalance).eq(25111111111111); // receive 111111111111 as reward

      lp1LiquidityReserveBalance = await LiquidityReserveV2.balanceOf(
        liquidityProvider1
      );
      expect(lp1LiquidityReserveBalance).eq(0);

      // withdraw and check daoTreasury
      daoLiquidityReserveBalance = await LiquidityReserveV2.balanceOf(
        daoTreasury
      );
      await liquidityReserveDao.removeLiquidity(daoLiquidityReserveBalance);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(100444444444444); // receive 444444444444 (4x the reward)

      // lr tokens are 0
      daoLiquidityReserveBalance = await LiquidityReserveV2.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(0);

      const daoTreasuryReward = daoTreasuryStakingBalance.sub(transferAmount);
      const lp1Reward = lp1StakingBalance.sub(stakingAmount);

      expect(daoTreasuryReward).eq(lp1Reward.mul(4));
    });
    it("Should calculate the correct value of lrFOX with multiple providers", async () => {
      const { daoTreasury, staker1, liquidityProvider1 } =
        await getNamedAccounts();

      const transferAmount = BigNumber.from("100000000000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(daoTreasury, transferAmount);
      await stakingToken.transfer(liquidityProvider1, stakingAmount);

      // add liquidity with daoTreasury
      let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(transferAmount);

      let daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(0);

      const daoTreasurySigner = accounts.find(
        (account) => account.address === daoTreasury
      );
      const liquidityReserveDao = liquidityReserve.connect(
        daoTreasurySigner as Signer
      );
      const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);

      await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
      await liquidityReserveDao.addLiquidity(transferAmount);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(0);

      daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(transferAmount);

      // add liquidity with liquidityProvider1
      const liquidityProvider1Signer = accounts.find(
        (account) => account.address === liquidityProvider1
      );
      const liquidityReserveLiquidityProvider = liquidityReserve.connect(
        liquidityProvider1Signer as Signer
      );
      const stakingTokenLiquidityProvider = stakingToken.connect(
        liquidityProvider1Signer as Signer
      );

      await stakingTokenLiquidityProvider.approve(
        liquidityReserve.address,
        stakingAmount
      );
      await liquidityReserveLiquidityProvider.addLiquidity(stakingAmount);

      let lp1StakingBalance = await stakingToken.balanceOf(liquidityProvider1);
      expect(lp1StakingBalance).eq(0);

      let lp1LiquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(lp1LiquidityReserveBalance).eq(stakingAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, stakingAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // stake stakingToken to get rewardToken
      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );

      await stakingTokenStaker1.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker1.functions["stake(uint256)"](stakingAmount);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      const fee = await liquidityReserve.fee();

      // instant unstake with staker1
      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(
        liquidityReserve.address,
        transferAmount
      );
      await rewardTokenStaker1.approve(stakingContract.address, transferAmount);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await stakingContract.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker1.instantUnstakeReserve(totalBalance);

      const feeAmount = stakingAmount.mul(fee).div(10000);
      const amountMinusFee = stakingAmount.sub(feeAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(amountMinusFee);

      // withdraw and check liquidityProvider1
      lp1LiquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );

      // withdraw with liquidityProvider1 && daoTreasury
      await liquidityReserveLiquidityProvider.removeLiquidity(
        lp1LiquidityReserveBalance
      );

      lp1StakingBalance = await stakingToken.balanceOf(liquidityProvider1);
      expect(lp1StakingBalance).eq(25111111111111); // receive 111111111111 as reward

      lp1LiquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(lp1LiquidityReserveBalance).eq(0);

      // withdraw and check daoTreasury
      daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      await liquidityReserveDao.removeLiquidity(daoLiquidityReserveBalance);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(100444444444444); // receive 444444444444 (4x the reward)

      // lr tokens are 0
      daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(0);

      const daoTreasuryReward = daoTreasuryStakingBalance.sub(transferAmount);
      const lp1Reward = lp1StakingBalance.sub(stakingAmount);

      expect(daoTreasuryReward).eq(lp1Reward.mul(4));
    });
    it("Should call unstake with full unstake amount, only when reserve has no cool down info", async () => {
      const { daoTreasury, staker1, staker2, staker3, liquidityProvider1 } =
        await getNamedAccounts();
      const transferAmount = BigNumber.from("100000000000000");
      const stakingAmount = transferAmount.div(4);

      await stakingToken.transfer(daoTreasury, transferAmount);
      await stakingToken.transfer(liquidityProvider1, stakingAmount);

      // add liquidity with daoTreasury
      let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(transferAmount);

      let daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(0);

      const daoTreasurySigner = accounts.find(
        (account) => account.address === daoTreasury
      );
      const liquidityReserveDao = liquidityReserve.connect(
        daoTreasurySigner as Signer
      );
      const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);

      await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
      await liquidityReserveDao.addLiquidity(transferAmount);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(0);

      daoLiquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoLiquidityReserveBalance).eq(transferAmount);

      // add liquidity with liquidityProvider1
      const liquidityProvider1Signer = accounts.find(
        (account) => account.address === liquidityProvider1
      );
      const liquidityReserveLiquidityProvider = liquidityReserve.connect(
        liquidityProvider1Signer as Signer
      );
      const stakingTokenLiquidityProvider = stakingToken.connect(
        liquidityProvider1Signer as Signer
      );

      await stakingTokenLiquidityProvider.approve(
        liquidityReserve.address,
        stakingAmount
      );
      await liquidityReserveLiquidityProvider.addLiquidity(stakingAmount);

      const lp1StakingBalance = await stakingToken.balanceOf(
        liquidityProvider1
      );
      expect(lp1StakingBalance).eq(0);

      const lp1LiquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(lp1LiquidityReserveBalance).eq(stakingAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, stakingAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // get stakingToken at staker2
      await stakingToken.transfer(staker2, stakingAmount);

      const staking2Signer = accounts.find(
        (account) => account.address === staker2
      );

      // get stakingToken at staker3
      await stakingToken.transfer(staker3, stakingAmount);

      const staking3Signer = accounts.find(
        (account) => account.address === staker3
      );

      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );
      const stakingContractStaker2 = stakingContract.connect(
        staking2Signer as Signer
      );
      const stakingTokenStaker2 = stakingToken.connect(
        staking2Signer as Signer
      );
      const stakingContractStaker3 = stakingContract.connect(
        staking3Signer as Signer
      );
      const stakingTokenStaker3 = stakingToken.connect(
        staking3Signer as Signer
      );

      // stake with staker1, staker2, and staker3
      await stakingTokenStaker1.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker1.functions["stake(uint256)"](stakingAmount);
      await stakingTokenStaker2.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker2.functions["stake(uint256)"](stakingAmount);
      await stakingTokenStaker3.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker3.functions["stake(uint256)"](stakingAmount);

      const staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      // instant unstake with staker1
      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(stakingContract.address, transferAmount);

      let walletBalance = await rewardToken.balanceOf(staker1);
      let warmUpInfo = await stakingContract.warmUpInfo(staker1);
      let warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      let totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker1.instantUnstakeReserve(totalBalance);

      let coolDownInfo = await stakingContract.coolDownInfo(
        liquidityReserve.address
      );
      expect(coolDownInfo.amount).eq(stakingAmount);

      // instant unstake with staker2
      // not unstaked through tokemak yet
      const rewardTokenStaker2 = rewardToken.connect(staking2Signer as Signer);
      await rewardTokenStaker2.approve(stakingContract.address, transferAmount);

      walletBalance = await rewardToken.balanceOf(staker2);
      warmUpInfo = await stakingContract.warmUpInfo(staker2);
      warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker2.instantUnstakeReserve(totalBalance);

      coolDownInfo = await stakingContract.coolDownInfo(
        liquidityReserve.address
      );
      expect(coolDownInfo.amount).eq(stakingAmount);

      coolDownInfo = await stakingContract.coolDownInfo(
        liquidityReserve.address
      );
      expect(coolDownInfo.amount).eq(stakingAmount);

      await mineBlocksToNextCycle();
      await stakingContract.sendWithdrawalRequests();
      await stakingContract.rebase();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      // instant unstake with staker3 and all reward tokens are unstaked
      const rewardTokenStaker3 = rewardToken.connect(staking3Signer as Signer);
      await rewardTokenStaker3.approve(stakingContract.address, transferAmount);

      walletBalance = await rewardToken.balanceOf(staker3);
      warmUpInfo = await stakingContract.warmUpInfo(staker3);
      warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker3.instantUnstakeReserve(totalBalance);

      coolDownInfo = await stakingContract.coolDownInfo(
        liquidityReserve.address
      );
      expect(coolDownInfo.amount).eq(stakingAmount.mul(2));
    });
    it("Liquidity providers should get correct amounts", async () => {
      const { daoTreasury, staker1, liquidityProvider1 } =
        await getNamedAccounts();

      const transferAmount = BigNumber.from("100000000000000");
      const stakingAmount = transferAmount.div(4);

      // deposit stakingToken with daoTreasury
      await stakingToken.transfer(daoTreasury, transferAmount);

      let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(transferAmount);

      let liquidityReserveBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(liquidityReserveBalance).eq(0);

      const daoTreasurySigner = accounts.find(
        (account) => account.address === daoTreasury
      );
      const liquidityReserveDao = liquidityReserve.connect(
        daoTreasurySigner as Signer
      );
      const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);

      await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
      await liquidityReserveDao.addLiquidity(transferAmount);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(0);

      liquidityReserveBalance = await liquidityReserve.balanceOf(daoTreasury);
      expect(liquidityReserveBalance).eq(transferAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, stakingAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // stake stakingToken to get rewardToken
      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );

      await stakingTokenStaker1.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker1.functions["stake(uint256)"](stakingAmount);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(stakingAmount);

      const fee = await liquidityReserve.fee();

      // instant unstake with staker1

      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(liquidityReserve.address, stakingAmount);
      await rewardTokenStaker1.approve(stakingContract.address, transferAmount);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await stakingContract.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker1.instantUnstakeReserve(totalBalance);

      const feeAmount = stakingAmount.mul(fee).div(10000);
      const amountMinusFee = stakingAmount.sub(feeAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(amountMinusFee);

      // deposit with liquidityProvider1
      await stakingToken.transfer(liquidityProvider1, stakingAmount);

      let liquidityProvider1StakingBalance = await stakingToken.balanceOf(
        liquidityProvider1
      );
      expect(liquidityProvider1StakingBalance).eq(stakingAmount);

      liquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(liquidityReserveBalance).eq(0);

      const liquidityProvider1Signer = accounts.find(
        (account) => account.address === liquidityProvider1
      );
      const liquidityReserveLiquidityProvider = liquidityReserve.connect(
        liquidityProvider1Signer as Signer
      );
      const stakingTokenLiquidityProvider = stakingToken.connect(
        liquidityProvider1Signer as Signer
      );

      await stakingTokenLiquidityProvider.approve(
        liquidityReserve.address,
        stakingAmount
      );
      await liquidityReserveLiquidityProvider.addLiquidity(stakingAmount);

      liquidityProvider1StakingBalance = await stakingToken.balanceOf(
        liquidityProvider1
      );
      expect(liquidityProvider1StakingBalance).eq(0);

      liquidityReserveBalance = await liquidityReserve.balanceOf(daoTreasury);
      expect(liquidityReserveBalance).eq(100000000000000);
      await liquidityReserveDao.removeLiquidity(liquidityReserveBalance);

      liquidityProvider1StakingBalance = await stakingToken.balanceOf(
        daoTreasury
      );
      expect(liquidityProvider1StakingBalance).eq(100454545454545); // balance after gaining rewards

      liquidityReserveBalance = await liquidityReserve.balanceOf(
        liquidityProvider1
      );
      expect(liquidityReserveBalance).eq(24886877828054); // 24886877828054 is the new balance based on new liquidity

      // withdraw with liquidityProvider1
      await liquidityReserveLiquidityProvider.removeLiquidity(
        liquidityReserveBalance
      );

      liquidityProvider1StakingBalance = await stakingToken.balanceOf(
        liquidityProvider1
      );
      expect(liquidityProvider1StakingBalance).eq(24999999999999); // no rewards due to staking after instantUnstake occured
    });
    it("Should not allow user to withdraw more than contract contains", async () => {
      const { daoTreasury, staker1 } = await getNamedAccounts();
      let lrStakingBalance = await stakingToken.balanceOf(
        liquidityReserve.address
      );
      expect(lrStakingBalance).eq(constants.INITIAL_LR_BALANCE);

      const transferAmount = BigNumber.from("4000000000000000");

      await stakingToken.transfer(daoTreasury, transferAmount);

      let daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(transferAmount);

      let daoTreasuryLiquidityBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoTreasuryLiquidityBalance).eq(0);

      const daoTreasurySigner = accounts.find(
        (account) => account.address === daoTreasury
      );
      const liquidityReserveDao = liquidityReserve.connect(
        daoTreasurySigner as Signer
      );
      const stakingTokenDao = stakingToken.connect(daoTreasurySigner as Signer);
      await stakingTokenDao.approve(liquidityReserve.address, transferAmount);
      await liquidityReserveDao.addLiquidity(transferAmount);

      daoTreasuryStakingBalance = await stakingToken.balanceOf(daoTreasury);
      expect(daoTreasuryStakingBalance).eq(0);

      daoTreasuryLiquidityBalance = await liquidityReserve.balanceOf(
        daoTreasury
      );
      expect(daoTreasuryLiquidityBalance).eq(transferAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, transferAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // stake stakingToken to get rewardToken
      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );

      await stakingTokenStaker1.approve(
        stakingContract.address,
        transferAmount
      );
      await stakingContractStaker1.functions["stake(uint256)"](transferAmount);

      await stakingContractStaker1.claim(staker1);

      let staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(transferAmount);

      const fee = await liquidityReserve.fee();
      lrStakingBalance = await stakingToken.balanceOf(liquidityReserve.address);

      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(
        liquidityReserve.address,
        transferAmount
      );
      await rewardTokenStaker1.approve(stakingContract.address, transferAmount);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await stakingContract.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingContractStaker1.instantUnstakeReserve(totalBalance);

      const feeAmount = transferAmount.mul(fee).div(10000);
      const amountMinusFee = transferAmount.sub(feeAmount);

      staker1RewardBalance = await rewardToken.balanceOf(staker1);
      expect(staker1RewardBalance).eq(0);

      const staker1StakingBalance = await stakingToken.balanceOf(staker1);
      expect(staker1StakingBalance).eq(amountMinusFee);

      // withdraw all with DAO
      // should revert due to not enough stakingTokens in contract due to instant unstake
      lrStakingBalance = await stakingToken.balanceOf(liquidityReserve.address);
      expect(lrStakingBalance).eq(1800000000000000); // amount after instant unstake

      const daoBalance = await liquidityReserveDao.balanceOf(daoTreasury);
      expect(daoBalance).eq(4000000000000000); // more than staking tokens in liquidity reserve

      await expect(
        liquidityReserveDao.removeLiquidity(daoBalance)
      ).to.be.revertedWith("Not enough funds");
    });
  });

  describe("fail states", () => {
    it("Fails when no staking/reward token or staking contract is passed in", async () => {
      const { admin, staker1 } = await getNamedAccounts();

      const liquidityFactory = await ethers.getContractFactory(
        "LiquidityReserve"
      );

      // fail due to no staking/reward token
      await expect(
        upgrades.deployProxy(liquidityFactory, [
          "Liquidity Reserve FOX",
          "lrFOX",
          ethers.constants.AddressZero,
          rewardToken.address,
        ])
      ).to.be.reverted;

      await expect(
        upgrades.deployProxy(liquidityFactory, [
          "Liquidity Reserve FOX",
          "lrFOX",
          constants.STAKING_TOKEN,
          ethers.constants.AddressZero,
        ])
      ).to.be.reverted;

      const liquidityReserveContract = (await upgrades.deployProxy(
        liquidityFactory,
        [
          "Liquidity Reserve FOX",
          "lrFOX",
          constants.STAKING_TOKEN,
          rewardToken.address,
        ]
      )) as LiquidityReserve;

      // fail due to no stakingContract
      await expect(
        liquidityReserveContract.enableLiquidityReserve(
          ethers.constants.AddressZero
        )
      ).to.be.revertedWith("Invalid address");

      const transferAmount = await stakingToken.balanceOf(admin);
      await stakingToken.transfer(staker1, transferAmount);

      // fail due to not enough liquidity
      await expect(
        liquidityReserveContract.enableLiquidityReserve(stakingContract.address)
      ).to.be.revertedWith("Not enough staking tokens");

      // fail since not the owner
      await expect(
        liquidityReserveContract
          .connect(accounts[3])
          .enableLiquidityReserve(stakingContract.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");

      const adminSigner = accounts.find(
        (account) => account.address === admin
      ) as Signer;
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;
      await stakingToken
        .connect(staker1Signer)
        .transfer(admin, await stakingToken.balanceOf(staker1));
      await stakingToken
        .connect(adminSigner)
        .approve(
          liquidityReserveContract.address,
          await stakingToken.balanceOf(admin)
        );
      await liquidityReserveContract
        .connect(adminSigner)
        .enableLiquidityReserve(stakingContract.address);

      // fail since already called!
      await expect(
        liquidityReserveContract
          .connect(adminSigner)
          .enableLiquidityReserve(stakingContract.address)
      ).to.be.revertedWith("Already enabled");
    });

    it("Must have correct fee amount", async () => {
      await expect(
        liquidityReserve.setFee(BigNumber.from("10000000000"))
      ).to.be.revertedWith("Out of range");
    });

    it("Withdraw has required balance", async () => {
      await expect(
        liquidityReserve.removeLiquidity("1000000000000000000000")
      ).to.be.revertedWith("Not enough lr tokens");
    });

    it("instantUnstake has required balance", async () => {
      const { staker1, daoTreasury, liquidityProvider1 } =
        await getNamedAccounts();

      // try to instantUnstake when liquidityReserve is drained
      const liquidityFactory = await ethers.getContractFactory(
        "LiquidityReserve"
      );
      const liquidityReserveContract = (await upgrades.deployProxy(
        liquidityFactory,
        [
          "Liquidity Reserve FOX",
          "lrFOX",
          constants.STAKING_TOKEN,
          rewardToken.address,
        ]
      )) as LiquidityReserve;

      await expect(
        liquidityReserveContract.instantUnstake(1000, staker1)
      ).to.be.revertedWith("Not staking contract");

      const stakingAmount = BigNumber.from("1000000000001000");

      await stakingToken.transfer(daoTreasury, stakingAmount);
      await stakingToken.transfer(liquidityProvider1, stakingAmount);

      // get stakingToken at staker1
      await stakingToken.transfer(staker1, stakingAmount);

      const staking1Signer = accounts.find(
        (account) => account.address === staker1
      );

      // stake stakingToken to get rewardToken
      const stakingContractStaker1 = stakingContract.connect(
        staking1Signer as Signer
      );
      const stakingTokenStaker1 = stakingToken.connect(
        staking1Signer as Signer
      );

      await stakingTokenStaker1.approve(stakingContract.address, stakingAmount);
      await stakingContractStaker1.functions["stake(uint256)"](stakingAmount);

      // instant unstake with staker1
      const rewardTokenStaker1 = rewardToken.connect(staking1Signer as Signer);
      await rewardTokenStaker1.approve(liquidityReserve.address, stakingAmount);
      await rewardTokenStaker1.approve(stakingContract.address, stakingAmount);

      await expect(
        stakingContractStaker1.instantUnstakeReserve("90000000000001000")
      ).to.be.revertedWith("Insufficient Balance");
    });
  });

  describe("addLiquidity", function () {
    it("Issue correct balances of LR Fox with multiple LPs", async () => {
      const {
        liquidityProvider1,
        liquidityProvider2,
        liquidityProvider3,
        staker1,
      } = await getNamedAccounts();

      const liquidityProvider1Signer = accounts.find(
        (account) => account.address === liquidityProvider1
      );
      const liquidityProvider2Signer = accounts.find(
        (account) => account.address === liquidityProvider2
      );
      const liquidityProvider3Signer = accounts.find(
        (account) => account.address === liquidityProvider3
      );
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const transferAmount = BigNumber.from("1000000000000000");
      await liquidityReserve.setFee(9000); // 90%

      await stakingToken.transfer(liquidityProvider1, transferAmount);
      await stakingToken.transfer(liquidityProvider2, transferAmount);
      await stakingToken.transfer(liquidityProvider3, transferAmount);
      await stakingToken.transfer(staker1, transferAmount);

      // add needed approvals
      await stakingToken
        .connect(liquidityProvider1Signer as Signer)
        .approve(liquidityReserve.address, transferAmount);
      await stakingToken
        .connect(liquidityProvider2Signer as Signer)
        .approve(liquidityReserve.address, transferAmount);
      await stakingToken
        .connect(liquidityProvider3Signer as Signer)
        .approve(liquidityReserve.address, transferAmount);

      // add liquidity from LPer 1 and 2
      await liquidityReserve
        .connect(liquidityProvider1Signer as Signer)
        .addLiquidity(transferAmount);
      await liquidityReserve
        .connect(liquidityProvider2Signer as Signer)
        .addLiquidity(transferAmount);

      expect(await liquidityReserve.balanceOf(liquidityProvider1)).eq(
        transferAmount
      );
      expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
        transferAmount
      );

      // create a staker who call instant unstake and pays a fee
      const stakingAmount = transferAmount;
      await stakingToken
        .connect(staker1Signer as Signer)
        .approve(stakingContract.address, stakingAmount);
      await stakingContract
        .connect(staker1Signer as Signer)
        .functions["stake(uint256)"](stakingAmount);
      await rewardToken
        .connect(staker1Signer as Signer)
        .approve(stakingContract.address, transferAmount);

      const walletBalance = await rewardToken.balanceOf(staker1);
      const warmUpInfo = await stakingContract.warmUpInfo(staker1);
      const warmUpBalance = await rewardToken.tokenBalanceForCredits(
        warmUpInfo.credits
      );
      const totalBalance = walletBalance.add(warmUpBalance);
      await stakingContract
        .connect(staker1Signer as Signer)
        .instantUnstakeReserve(totalBalance);

      expect(await stakingToken.balanceOf(staker1)).eq(
        stakingAmount.mul(1000).div(10000)
      );

      // add LP from another users
      await liquidityReserve
        .connect(liquidityProvider3Signer as Signer)
        .addLiquidity(transferAmount.div(2));

      expect(await liquidityReserve.balanceOf(liquidityProvider3)).eq(
        384615384615384
      );

      await liquidityReserve
        .connect(liquidityProvider3Signer as Signer)
        .removeLiquidity(384615384615384);

      expect(await liquidityReserve.balanceOf(liquidityProvider3)).eq(0);
      expect(await stakingToken.balanceOf(liquidityProvider3)).eq(
        999999999999999
      );

      await liquidityReserve
        .connect(liquidityProvider1Signer as Signer)
        .removeLiquidity(transferAmount);

      const initalLperRewards = 1300000000000000;
      expect(await stakingToken.balanceOf(liquidityProvider1)).eq(
        initalLperRewards
      );

      expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
        transferAmount
      );

      // lp #2 cannot withdraw since FOX is in tokemak...
      // advance and ensure we can withdraw.

      await mineBlocksToNextCycle();
      await stakingContract.sendWithdrawalRequests();

      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [constants.TOKE_OWNER],
      });
      const tokeSigner = await ethers.getSigner(constants.TOKE_OWNER);
      const tokeManagerOwner = tokeManager.connect(tokeSigner);
      await tokeManagerOwner.completeRollover(constants.LATEST_CLAIMABLE_HASH);

      expect(await stakingToken.balanceOf(liquidityProvider2)).eq(0);
      expect(await liquidityReserve.balanceOf(liquidityProvider2)).eq(
        1000000000000000
      );
      expect(await rewardToken.balanceOf(liquidityProvider2)).eq(0);

      expect(await stakingToken.balanceOf(liquidityReserve.address)).eq(
        1600000000000001
      );
      expect(await rewardToken.balanceOf(liquidityReserve.address)).eq(0);

      await stakingContract.claimWithdraw(liquidityReserve.address);

      expect(await stakingToken.balanceOf(liquidityReserve.address)).eq(
        2600000000000001
      );
      expect(await rewardToken.balanceOf(liquidityReserve.address)).eq(0);

      // can't unstake with 0 staking tokens in liquidity reserve
      expect(await rewardToken.balanceOf(liquidityReserve.address)).eq(0);
      await liquidityReserve.unstakeAllRewardTokens();

      await liquidityReserve
        .connect(liquidityProvider2Signer as Signer)
        .removeLiquidity(transferAmount);

      // should be same as liquidityProvider1
      expect(await stakingToken.balanceOf(liquidityProvider2)).eq(
        initalLperRewards
      );
    });
  });
});
