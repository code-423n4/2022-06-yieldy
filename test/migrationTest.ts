import { ethers, getNamedAccounts, network, upgrades } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, Signer } from "ethers";
import { Yieldy } from "../typechain-types/Yieldy";
import { stakingV1Abi } from "../src/abis/stakingV1Abi";
import { abi as yieldyAbi } from "../artifacts/src/contracts/Yieldy.sol/Yieldy.json";
import { abi as liquidityReserveAbi } from "../artifacts/src/contracts/LiquidityReserve.sol/LiquidityReserve.json";
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { LiquidityReserve, Migration, StakingV2Test } from "../typechain-types";
import * as constants from "./constants";

describe("Migration", function () {
  let accounts: SignerWithAddress[];

  // Version-independent contracts
  let stakingToken: Contract;
  let migration: Migration;

  // V1 contracts
  let rewardToken: Contract;
  let staking: Contract;
  let liquidityReserve: Contract;

  // V2 contracts
  let rewardTokenV2: Yieldy;
  let stakingV2: StakingV2Test;
  let liquidityReserveV2: LiquidityReserve;

  // Dev functions for convenient balance tracking when writing tests

  // Print relevant balances for staker
  // async function printBalances(staker: string, title = "") {
  //   const stakerStakingTokenBalance = await stakingToken.balanceOf(staker);
  //   const stakerRewardTokenBalance = await rewardToken.balanceOf(staker);
  //   const warmUpAmount = (await staking.warmUpInfo(staker)).amount;
  //   const coolDownAmount = (await staking.coolDownInfo(staker)).amount;

  //   console.log(`  ------------------`);
  //   console.log(`  ${title}`);
  //   console.log(`    staking token: ${stakerStakingTokenBalance}`);
  //   console.log(`    reward token: ${stakerRewardTokenBalance}`);
  //   console.log(`    warmup: ${warmUpAmount}`);
  //   console.log(`    cooldown: ${coolDownAmount}`);
  // }

  // Print relevant balances for staker in V2 contract
  // async function printBalancesV2(staker: string, title = "") {
  //   const stakerStakingTokenBalance = await stakingToken.balanceOf(staker);
  //   const stakerRewardTokenBalance = await rewardTokenV2.balanceOf(staker);
  //   const warmUpAmount = (await stakingV2.warmUpInfo(staker)).amount;
  //   const coolDownAmount = (await stakingV2.coolDownInfo(staker)).amount;

  //   console.log(`  ------------------`);
  //   console.log(`  ${title}`);
  //   console.log(`    staking token: ${stakerStakingTokenBalance}`);
  //   console.log(`    reward token: ${stakerRewardTokenBalance}`);
  //   console.log(`    warmup: ${warmUpAmount}`);
  //   console.log(`    cooldown: ${coolDownAmount}`);
  // }

  // Util function for a more readable balance check
  async function confirmBalance(
    staker: string,
    token: Contract,
    amount: BigNumber | number
  ) {
    const tokenBalance = await token.balanceOf(staker);
    return expect(tokenBalance).eq(amount);
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

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [constants.STAKING_OWNER],
    });

    const stakingOwnerSigner = await ethers.getSigner(constants.STAKING_OWNER);
    // const stakingOwner = staking.connect(stakingOwnerSigner as Signer);

    // Give Staking v1 owner 100000 ETH for gas
    await network.provider.send("hardhat_setBalance", [
      constants.STAKING_OWNER,
      "0x10000000000000000000000",
    ]);

    staking = new ethers.Contract(
      constants.STAKING_V1_ADDRESS,
      stakingV1Abi,
      stakingOwnerSigner
    );

    stakingToken = new ethers.Contract(
      await staking.STAKING_TOKEN(),
      ERC20.abi,
      accounts[0]
    );

    rewardToken = new ethers.Contract(
      await staking.REWARD_TOKEN(),
      yieldyAbi,
      stakingOwnerSigner
    );

    liquidityReserve = new ethers.Contract(
      await staking.LIQUIDITY_RESERVE(),
      liquidityReserveAbi,
      stakingOwnerSigner
    );

    // Deploy v2 FOXy
    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardTokenV2 = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await rewardTokenV2.deployed();

    // Deploy v2 LiquidityReserve
    const liquidityReserveDeployment = await ethers.getContractFactory(
      "LiquidityReserve"
    );
    liquidityReserveV2 = (await upgrades.deployProxy(
      liquidityReserveDeployment,
      [
        "Liquidity Reserve FOX",
        "lrFOX",
        constants.STAKING_TOKEN,
        rewardTokenV2.address,
      ]
    )) as LiquidityReserve;
    await liquidityReserveV2.deployed();

    // Deploy v2 Staking
    const stakingDeploymentV2 = await ethers.getContractFactory(
      "StakingV2Test"
    );

    const currentBlock = await ethers.provider.getBlockNumber();
    const currentTime = (await ethers.provider.getBlock(currentBlock))
      .timestamp;
    const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

    stakingV2 = (await upgrades.deployProxy(stakingDeploymentV2, [
      stakingToken.address,
      rewardTokenV2.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      liquidityReserveV2.address,
      ethers.constants.AddressZero,
      constants.CURVE_POOL,
      constants.EPOCH_DURATION,
      firstEpochEndTime,
    ])) as StakingV2Test;

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

    // Initialize v2 LiquidityReserve
    await rewardTokenV2.initializeStakingContract(stakingV2.address); // initialize reward contract
    await stakingToken.approve(
      liquidityReserveV2.address,
      BigNumber.from("1000000000000000")
    ); // approve initial liquidity amount
    await liquidityReserveV2.enableLiquidityReserve(stakingV2.address);
    await liquidityReserveV2.setFee(constants.INSTANT_UNSTAKE_FEE);

    // add liquidity with lp1
    const reserveAmount = "999999999999000";
    const adminSigner = accounts.find((account) => account.address === admin);

    await stakingToken
      .connect(adminSigner as Signer)
      .approve(liquidityReserve.address, ethers.constants.MaxUint256);

    await liquidityReserve
      .connect(adminSigner as Signer)
      .addLiquidity(reserveAmount);

    await stakingToken
      .connect(adminSigner as Signer)
      .approve(liquidityReserveV2.address, ethers.constants.MaxUint256);

    await liquidityReserveV2
      .connect(adminSigner as Signer)
      .addLiquidity(reserveAmount);

    // Deploy Migration
    const migrationFactory = await ethers.getContractFactory("Migration");
    migration = await migrationFactory.deploy(
      staking.address,
      stakingV2.address
    );
  });

  describe("initialize", function () {
    it("Should initialize correctly", async () => {
      const migrationFactory = await ethers.getContractFactory("Migration");

      const migration = await migrationFactory.deploy(
        staking.address,
        stakingV2.address
      );

      const oldContract = await migration.OLD_CONTRACT();
      expect(oldContract).eq(staking.address);

      const newContract = await migration.NEW_CONTRACT();
      expect(newContract).eq(stakingV2.address);
    });

    it("Should fail when no oldContract or newContract address is passed", async () => {
      const migrationFactory = await ethers.getContractFactory("Migration");

      await expect(
        migrationFactory.deploy(staking.address, ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid address");

      await expect(
        migrationFactory.deploy(ethers.constants.AddressZero, stakingV2.address)
      ).to.be.revertedWith("Invalid address");
    });
  });

  describe("restaking", function () {
    it("Should move rewardTokens from V1 to V2", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);
      stakingStaker1.claim(staker1);

      // should have full balance before migration
      await confirmBalance(staker1, rewardToken, transferAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, transferAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // should have no v1 balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // should have full balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, transferAmount);
    });

    it("Should only move FOXy even if user has FOX balance", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);

      // equal amounts will be kept as unstaked tokens and staked
      const stakingAmount = transferAmount.div(2);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      stakingStaker1.claim(staker1);

      // should have correct FOXy balance before migration
      await confirmBalance(staker1, rewardToken, stakingAmount);

      // should have correct FOX balance before migration
      await confirmBalance(staker1, stakingToken, stakingAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, stakingAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // should have no v1 FOXy balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // should have full FOXy balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, stakingAmount);

      // should have FOX balance intact after migration
      await confirmBalance(staker1, stakingToken, stakingAmount);
    });

    it("Should move only wallet FOXy when user has warmup balance", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("15000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);

      // equal amounts will be kept as unstaked tokens, staked and held in warmup
      const stakingAmount = transferAmount.div(3);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount);
      stakingStaker1.claim(staker1);

      // move tokens to warmup contract
      await staking.setWarmUpPeriod(1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // should have correct FOX balance before migration
      await confirmBalance(staker1, stakingToken, stakingAmount);

      // should have correct FOXy balance before migration
      await confirmBalance(staker1, rewardToken, stakingAmount);

      // should have correct warmup balance before migration
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, stakingAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // should have no v1 FOXy balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // should have full FOXy balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, stakingAmount);

      // should have FOX balance intact after migration
      await confirmBalance(staker1, stakingToken, stakingAmount);

      // should have warmup balance intact after migration
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);
    });

    it("Should move only wallet FOXy when user has warmup and cooldown balance", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);

      // equal amounts will be kept as unstaked tokens, staked, held in warmup and cooldown
      const stakingAmount = transferAmount.div(4);

      await stakingStaker1.functions["stake(uint256)"](stakingAmount.mul(2));
      stakingStaker1.claim(staker1);

      // unstake tokens, moving them to cooldown contract
      await staking.setCoolDownPeriod(2);
      const rewardTokenStaker1 = await rewardToken.connect(
        staker1Signer as Signer
      );
      await rewardTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.unstake(stakingAmount, false);

      // move tokens to warmup contract
      await staking.setWarmUpPeriod(1);
      await stakingStaker1.functions["stake(uint256)"](stakingAmount);

      // should have correct FOX balance before migration
      await confirmBalance(staker1, stakingToken, stakingAmount);

      // should have correct FOXy balance before migration
      await confirmBalance(staker1, rewardToken, stakingAmount);

      // should have correct warmup balance before migration
      let warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should have correct cooldown balance before migration
      let coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);

      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, stakingAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // should have no v1 FOXy balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // should have full FOXy balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, stakingAmount);

      // should have FOX balance intact after migration
      await confirmBalance(staker1, stakingToken, stakingAmount);

      // should have warmup balance intact after migration
      warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(stakingAmount);

      // should have cooldown balance intact after migration
      coolDownInfo = await staking.coolDownInfo(staker1);
      expect(coolDownInfo.amount).eq(stakingAmount);
    });

    it("Should allow multiple users to migrate tokens", async () => {
      const { staker1, staker2 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");

      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      await stakingToken.transfer(staker2, transferAmount);
      const staker2Signer = accounts.find(
        (account) => account.address === staker2
      );
      const stakingStaker2 = staking.connect(staker2Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);
      stakingStaker1.claim(staker1);

      const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
      await stakingTokenStaker2.approve(staking.address, transferAmount);
      await stakingStaker2.functions["stake(uint256)"](transferAmount);
      stakingStaker2.claim(staker1);

      // should have full balance before migration
      await confirmBalance(staker1, rewardToken, transferAmount);
      await confirmBalance(staker2, rewardToken, transferAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, transferAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // staker1 should have no v1 balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // staker1 should have full balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, transferAmount);

      const rewardTokenStaker2 = rewardToken.connect(staker2Signer as Signer);
      const migrationStaker2 = migration.connect(staker2Signer as Signer);
      await rewardTokenStaker2.approve(migration.address, transferAmount);

      await migrationStaker2.functions.moveFundsToUpgradedContract();

      // staker2 should have no v1 balance after migration
      await confirmBalance(staker2, rewardToken, 0);

      // staker2 should have full balance in v2 after migration
      await confirmBalance(staker2, rewardTokenV2, transferAmount);
    });

    it("Should correctly instantUnstake from v2 after migrating", async () => {
      const { staker1 } = await getNamedAccounts();

      // non-round number to verify fee is correct
      const transferAmount = BigNumber.from("11111");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // instantUnstake fee should be set to 0 before migration
      await liquidityReserve.setFee(0);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);
      stakingStaker1.claim(staker1);

      // should have full balance before migration
      await confirmBalance(staker1, rewardToken, transferAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, transferAmount);

      await migrationStaker1.functions.moveFundsToUpgradedContract();

      // should have no v1 balance after migration
      await confirmBalance(staker1, rewardToken, 0);

      // should have full balance in v2 after migration
      await confirmBalance(staker1, rewardTokenV2, transferAmount);

      const rewardTokenV2Staker1 = rewardTokenV2.connect(
        staker1Signer as Signer
      );
      const stakingV2Staker1 = stakingV2.connect(staker1Signer as Signer);
      await rewardTokenV2Staker1.approve(stakingV2.address, transferAmount);
      await stakingV2Staker1.instantUnstakeReserve(transferAmount);

      const unstakingFee = await liquidityReserveV2.fee();
      const balanceMinusFee = transferAmount.sub(
        transferAmount.mul(unstakingFee).div(BigNumber.from("10000"))
      );

      // should be unstaked with the correct fee
      await confirmBalance(staker1, stakingToken, balanceMinusFee);
    });
  });

  describe("fail states", function () {
    it("Should revert if v1 instantUnstake fee is above 0", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      // warmUpPeriod should be set to 0 before migration
      await staking.setWarmUpPeriod(0);

      // set wrong fee
      await liquidityReserve.setFee(250);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);

      stakingStaker1.claim(staker1);

      // should have full balance before migration
      await confirmBalance(staker1, rewardToken, transferAmount);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, transferAmount);

      await expect(migrationStaker1.functions.moveFundsToUpgradedContract()).to
        .be.reverted;
    });

    it("Should revert if user has 0 FOXy in their wallet", async () => {
      const { staker1 } = await getNamedAccounts();
      const transferAmount = BigNumber.from("10000");
      await stakingToken.transfer(staker1, transferAmount);
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );
      const stakingStaker1 = staking.connect(staker1Signer as Signer);

      await staking.setWarmUpPeriod(1);

      const stakingTokenStaker1 = stakingToken.connect(staker1Signer as Signer);
      await stakingTokenStaker1.approve(staking.address, transferAmount);
      await stakingStaker1.functions["stake(uint256)"](transferAmount);
      stakingStaker1.claim(staker1);

      // should have full balance in warmup
      const warmUpInfo = await staking.warmUpInfo(staker1);
      expect(warmUpInfo.amount).eq(transferAmount);

      await confirmBalance(staker1, rewardToken, 0);

      const rewardTokenStaker1 = rewardToken.connect(staker1Signer as Signer);
      const migrationStaker1 = migration.connect(staker1Signer as Signer);
      await rewardTokenStaker1.approve(migration.address, transferAmount);

      await expect(
        migrationStaker1.functions.moveFundsToUpgradedContract()
      ).to.be.revertedWith("Must have reward tokens");
    });
  });
});
