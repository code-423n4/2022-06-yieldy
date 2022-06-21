import * as dotenv from "dotenv";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";
import "hardhat-contract-sizer";
import "hardhat-gas-reporter";
import "@nomiclabs/hardhat-etherscan";
import "hardhat-deploy";
import "solidity-coverage";
import "@openzeppelin/hardhat-upgrades";
import { HardhatUserConfig } from "hardhat/types";
import { BLOCK_NUMBER } from "./test/constants";

dotenv.config();

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.9",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100000,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1,
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
      forking: {
        url: process.env.MAINNET_URL || "",
        blockNumber: BLOCK_NUMBER,
        enabled: true, // Set to false to disable forked mainnet mode
      },
    },
    goerli: {
      url: process.env.GOERLI_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    rinkeby: {
      url: process.env.RINKEBY_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.MAINNET_URL || "",
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  paths: {
    deploy: "./scripts/deploy",
    deployments: "./deployments",
    sources: "./src/contracts",
  },
  namedAccounts: {
    admin: {
      default: 0,
    },
    daoTreasury: {
      default: 1,
    },
    staker1: {
      default: 2,
    },
    staker2: {
      default: 3,
    },
    staker3: {
      default: 4,
    },
    stakingContractMock: {
      default: 5,
    },
    liquidityProvider1: {
      default: 6,
    },
    liquidityProvider2: {
      default: 7,
    },
    liquidityProvider3: {
      default: 8,
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
  },
  gasReporter: {
    enabled: false,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  mocha: {
    timeout: 130000,
  },
};
export default config;
