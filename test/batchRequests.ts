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
import ERC20 from "@openzeppelin/contracts/build/contracts/ERC20.json";
import { Staking, BatchRequests, Yieldy } from "../typechain-types";
import * as constants from "./constants";
import { tokePoolAbi } from "../src/abis/tokePoolAbi";

describe("BatchRequests", function () {
  let accounts: SignerWithAddress[];
  let batchRequests: BatchRequests;
  let stakingToken: Contract;
  let rewardToken: Contract;
  let rewardToken2: Contract;
  let rewardToken3: Contract;
  let staking: Staking;
  let staking2: Staking;
  let staking3: Staking;
  let tokePool: Contract;

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

    const currentBlock = await ethers.provider.getBlockNumber();
    const currentTime = (await ethers.provider.getBlock(currentBlock))
      .timestamp;
    const firstEpochEndTime = currentTime + constants.EPOCH_DURATION;

    stakingToken = new ethers.Contract(
      constants.STAKING_TOKEN,
      ERC20.abi,
      accounts[0]
    );

    const rewardTokenDeployment = await ethers.getContractFactory("Yieldy");
    rewardToken = (await upgrades.deployProxy(rewardTokenDeployment, [
      "USDC Yieldy",
      "USDCy",
      18,
    ])) as Yieldy;
    await rewardToken.deployed();

    rewardToken2 = (await upgrades.deployProxy(rewardTokenDeployment, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await rewardToken2.deployed();

    rewardToken3 = (await upgrades.deployProxy(rewardTokenDeployment, [
      "ALX Yieldy",
      "ALXy",
      18,
    ])) as Yieldy;
    await rewardToken3.deployed();

    tokePool = new ethers.Contract(
      constants.TOKE_ADDRESS,
      tokePoolAbi,
      accounts[0]
    );

    const stakingDeployment = await ethers.getContractFactory("Staking");
    staking = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      stakingToken.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      constants.EPOCH_DURATION,
      firstEpochEndTime,
    ])) as Staking;

    staking2 = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken2.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      stakingToken.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      constants.EPOCH_DURATION,
      firstEpochEndTime,
    ])) as Staking;

    staking3 = (await upgrades.deployProxy(stakingDeployment, [
      stakingToken.address,
      rewardToken3.address,
      constants.TOKE_TOKEN,
      constants.TOKE_ADDRESS,
      constants.TOKE_MANAGER,
      constants.TOKE_REWARD,
      stakingToken.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      constants.EPOCH_DURATION,
      firstEpochEndTime,
    ])) as Staking;

    const batchDeployment = await ethers.getContractFactory("BatchRequests");
    batchRequests = await batchDeployment.deploy();

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
    await rewardToken.initializeStakingContract(staking.address); // initialize reward contract
    await rewardToken2.initializeStakingContract(staking2.address);
    await rewardToken3.initializeStakingContract(staking3.address);
  });

  it("Should add/remove contracts", async () => {
    await batchRequests.addAddress(constants.STAKING_TOKEN);
    await batchRequests.addAddress(constants.TOKE_TOKEN);
    await batchRequests.addAddress(constants.TOKE_REWARD);

    expect(await batchRequests.getAddressByIndex(0)).eq(
      constants.STAKING_TOKEN
    );
    expect(await batchRequests.getAddressByIndex(1)).eq(constants.TOKE_TOKEN);
    expect(await batchRequests.getAddressByIndex(2)).eq(constants.TOKE_REWARD);

    await batchRequests.removeAddress(constants.TOKE_TOKEN);
    await batchRequests.addAddress(constants.TOKE_OWNER);

    expect(await batchRequests.getAddressByIndex(0)).eq(
      constants.STAKING_TOKEN
    );
    expect(await batchRequests.getAddressByIndex(1)).eq(
      ethers.constants.AddressZero
    );
    expect(await batchRequests.getAddressByIndex(2)).eq(constants.TOKE_REWARD);
    expect(await batchRequests.getAddressByIndex(3)).eq(constants.TOKE_OWNER);
  });
  it("Should call sendWithdrawalRequests on multiple contracts", async () => {
    await batchRequests.addAddress(staking.address);
    await batchRequests.addAddress(staking2.address);
    await batchRequests.addAddress(staking3.address);

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
    await stakingTokenStaker1.approve(staking.address, transferAmount);
    await stakingStaker1.functions["stake(uint256)"](stakingAmount1);

    const stakingStaker2 = staking2.connect(staker2Signer as Signer);
    const stakingTokenStaker2 = stakingToken.connect(staker2Signer as Signer);
    await stakingTokenStaker2.approve(staking2.address, stakingAmount2);
    await stakingStaker2.functions["stake(uint256)"](stakingAmount2);

    const stakingStaker3 = staking3.connect(staker3Signer as Signer);
    const stakingTokenStaker3 = stakingToken.connect(staker3Signer as Signer);
    await stakingTokenStaker3.approve(staking3.address, stakingAmount3);
    await stakingStaker3.functions["stake(uint256)"](stakingAmount3);

    await rewardToken
      .connect(staker1Signer as Signer)
      .approve(staking.address, stakingAmount1);
    await stakingStaker1.unstake(stakingAmount1, false);

    await rewardToken3
      .connect(staker3Signer as Signer)
      .approve(staking3.address, stakingAmount3);
    await stakingStaker3.unstake(stakingAmount3, false);

    await mineToNextEpoch();

    const canBatchContracts = await batchRequests.canBatchContracts();

    const [address, canBatch] = await batchRequests.canBatchContractByIndex(0);
    expect(address).eq(staking.address);
    expect(canBatch).eq(true);
    expect(canBatchContracts[0].stakingContract).eq(staking.address);
    expect(canBatchContracts[0].canBatch).eq(true);

    const [address1, canBatch1] = await batchRequests.canBatchContractByIndex(
      1
    );
    expect(address1).eq(staking2.address);
    expect(canBatch1).eq(false);
    expect(canBatchContracts[1].stakingContract).eq(staking2.address);
    expect(canBatchContracts[1].canBatch).eq(false);

    const [address2, canBatch2] = await batchRequests.canBatchContractByIndex(
      2
    );
    expect(address2).eq(staking3.address);
    expect(canBatch2).eq(true);
    expect(canBatchContracts[2].stakingContract).eq(staking3.address);
    expect(canBatchContracts[2].canBatch).eq(true);

    await batchRequests.sendWithdrawalRequests();

    let requestedWithdrawals = await tokePool.requestedWithdrawals(
      staking.address
    );
    expect(requestedWithdrawals.amount).eq(stakingAmount1);

    requestedWithdrawals = await tokePool.requestedWithdrawals(
      staking2.address
    );
    expect(requestedWithdrawals.amount).eq(0);

    requestedWithdrawals = await tokePool.requestedWithdrawals(
      staking3.address
    );
    expect(requestedWithdrawals.amount).eq(stakingAmount3);
  });
});
