import { deploy } from "@openzeppelin/hardhat-upgrades/dist/utils";
import { ethers } from "hardhat";

// used to test cow trades from rinkeby testnet
async function main() {
  const CowSwapTest = await ethers.getContractFactory("CowSwapTest");

  console.info("Deploying CowSwapTest...");
  const cowSwapTest = await deploy(CowSwapTest);

  console.info("CowSwapTest deployed to:", cowSwapTest.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
