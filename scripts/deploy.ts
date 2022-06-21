import { upgrades, ethers } from "hardhat";

async function main() {
  const stakingToken = "0xc770EEfAd204B5180dF6a14Ee197D99d808ee52d";
  const tokeToken = "0x2e9d63788249371f1dfc918a52f8d799f4a38c94";
  const tokePool = "0x808D3E6b23516967ceAE4f17a5F9038383ED5311";
  const tokeManager = "0xa86e412109f77c45a3bc1c5870b880492fb86a14";
  const tokeReward = "0x79dD22579112d8a5F7347c5ED7E609e60da713C5";
  const curvePool = "0xC250B22d15e43d95fBE27B12d98B6098f8493eaC";

  const epochLength = 604800;

  const currentBlockNumber = await ethers.provider.getBlockNumber();
  const currentBlock = await ethers.provider.getBlock(currentBlockNumber);
  const firstEpochEndTime = currentBlock.timestamp + epochLength;

  const Staking = await ethers.getContractFactory("Staking");
  const yieldyDeployment = await ethers.getContractFactory("Yieldy");
  const liquidityReserveDeployment = await ethers.getContractFactory(
    "LiquidityReserve"
  );

  console.info("Deploying Yieldy...");
  const yieldy = await upgrades.deployProxy(yieldyDeployment, [
    "Fox Yieldy",
    "FOXy",
    18,
    500000000,
  ]);
  await yieldy.deployed();
  console.info("Yieldy deployed to:", yieldy.address);

  console.info("Deploying Liquidity Reserve...");
  const liquidityReserve = await upgrades.deployProxy(
    liquidityReserveDeployment,
    ["Liquidity Reserve FOX", "lrFOX", stakingToken, yieldy.address]
  );
  await liquidityReserve.deployed();
  console.info("Liquidity Reserve deployed to:", liquidityReserve.address);

  console.info("Deploying Staking...");
  const staking = await upgrades.deployProxy(Staking, [
    stakingToken,
    yieldy.address,
    tokeToken,
    tokePool,
    tokeManager,
    tokeReward,
    liquidityReserve.address,
    ethers.constants.AddressZero,
    curvePool,
    epochLength,
    firstEpochEndTime,
  ]);
  console.info("Staking deployed to:", staking.address);
  await staking.deployed();

  await liquidityReserve.enableLiquidityReserve(staking.address);
  await yieldy.initializeStakingContract(staking.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
