import { ethers, getNamedAccounts, upgrades } from "hardhat";
import { expect } from "chai";
import { Yieldy } from "../typechain-types/Yieldy";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, Contract, ContractFactory, Signer } from "ethers";
import { MockProvider } from "ethereum-waffle";
import {
  keccak256,
  toUtf8Bytes,
  defaultAbiCoder,
  solidityPack,
  hexlify,
} from "ethers/lib/utils";
import { ecsign } from "ethereumjs-util";

const PERMIT_TYPEHASH = keccak256(
  toUtf8Bytes(
    "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
  )
);

function getDomainSeparator(name: string, tokenAddress: string) {
  return keccak256(
    defaultAbiCoder.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [
        keccak256(
          toUtf8Bytes(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
          )
        ),
        keccak256(toUtf8Bytes(name)),
        keccak256(toUtf8Bytes("1")),
        1,
        tokenAddress,
      ]
    )
  );
}

export async function getApprovalDigest(
  token: Contract,
  approve: {
    owner: string;
    spender: string;
    value: BigNumber;
  },
  nonce: BigNumber,
  deadline: BigNumber
): Promise<string> {
  const name = await token.name();
  const DOMAIN_SEPARATOR = getDomainSeparator(name, token.address);
  return keccak256(
    solidityPack(
      ["bytes1", "bytes1", "bytes32", "bytes32"],
      [
        "0x19",
        "0x01",
        DOMAIN_SEPARATOR,
        keccak256(
          defaultAbiCoder.encode(
            ["bytes32", "address", "address", "uint256", "uint256", "uint256"],
            [
              PERMIT_TYPEHASH,
              approve.owner,
              approve.spender,
              approve.value,
              nonce,
              deadline,
            ]
          )
        ),
      ]
    )
  );
}

describe("Yieldy", function () {
  let accounts: SignerWithAddress[];
  let Yieldy: ContractFactory;
  let yieldy: Yieldy;

  beforeEach(async () => {
    // initialize Yieldy using a contract we control fully in place of the staking
    // contract allows for more localize testing
    accounts = await ethers.getSigners();
    const { stakingContractMock } = await getNamedAccounts();
    Yieldy = await ethers.getContractFactory("Yieldy");
    yieldy = (await upgrades.deployProxy(Yieldy, [
      "Fox Yieldy",
      "FOXy",
      18,
    ])) as Yieldy;
    await yieldy.deployed();

    await yieldy.initializeStakingContract(stakingContractMock);
  });

  describe("initializeStakingContract", function () {
    it("Should assign the MINTER_BURNER_ROLE to the stakingContract", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const hasRole = await yieldy.hasRole(
        await yieldy.MINTER_BURNER_ROLE(),
        stakingContractMock
      );
      // eslint-disable-next-line no-unused-expressions
      expect(hasRole).to.be.true;
    });

    it("Fails if called from non admin", async () => {
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
        18,
      ])) as Yieldy;

      await expect(
        yieldy1
          .connect(accounts[2])
          .initializeStakingContract(accounts[2].address)
      ).to.be.revertedWith(
        `AccessControl: account ${accounts[2].address.toLowerCase()} is missing role 0xdf8b4c520ffe197c5343c6f5aec59570151ef9a492f2c624fd45ddde6135ec42`
      );
    });

    it("Fails if _stakingContract is zero address", async () => {
      // fails due to no staking/reward token
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
        18,
      ])) as Yieldy;
      await expect(
        yieldy1.initializeStakingContract(ethers.constants.AddressZero)
      ).to.be.revertedWith("Invalid address");
    });

    it("Fails if called twice", async () => {
      // fails due to no staking/reward token
      const yieldy1 = (await upgrades.deployProxy(Yieldy, [
        "Fox Yieldy",
        "FOXy",
        18,
      ])) as Yieldy;
      await yieldy1.initializeStakingContract(accounts[1].address);
      await expect(
        yieldy1.initializeStakingContract(accounts[1].address)
      ).to.be.revertedWith("Already Initialized");
    });
  });

  describe("rebase", function () {
    it("Should distribute profits with one token holder", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.mint(staker1, initialHoldings);
      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit));
    });
    it("Should distribute profits with two token holders", async () => {
      const { staker1, staker2, stakingContractMock } =
        await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.mint(staker1, initialHoldings);
      await yieldyStakingContractSigner.mint(staker2, initialHoldings);

      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      const staker2InitialBalance = await yieldy.balanceOf(staker2);

      expect(staker1InitialBalance).eq(initialHoldings);
      expect(staker2InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("1000");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      const staker2BalanceAfterRebase = await yieldy.balanceOf(staker2);

      expect(staker1BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
      expect(staker2BalanceAfterRebase).eq(initialHoldings.add(profit.div(2)));
    });
    it("Only can call rebase from staking contract", async () => {
      const { staker1 } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      const staker1ContractSigner = yieldy.connect(staker1Signer as Signer);

      const profit = BigNumber.from("1000");
      // no circulating supply can't be rebased
      await expect(staker1ContractSigner.rebase(profit, BigNumber.from(1))).to
        .be.reverted;
    });
    it("Rebase with no circulating supply", async () => {
      const { stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      const profit = BigNumber.from("1000");
      // no circulating supply can't be rebased
      await expect(
        yieldyStakingContractSigner.rebase(profit, BigNumber.from(1))
      ).to.be.reverted;
    });
    it("If profit = 0 then no additional funds should be received", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const stakingContractSigner = accounts.find(
        (account) => account.address === stakingContractMock
      );

      const initialHoldings = BigNumber.from("1000000");
      const yieldyStakingContractSigner = yieldy.connect(
        stakingContractSigner as Signer
      );

      await yieldyStakingContractSigner.mint(staker1, initialHoldings);
      const staker1InitialBalance = await yieldy.balanceOf(staker1);
      expect(staker1InitialBalance).eq(initialHoldings);

      const profit = BigNumber.from("0");
      await yieldyStakingContractSigner.rebase(profit, BigNumber.from(1));

      const staker1BalanceAfterRebase = await yieldy.balanceOf(staker1);
      expect(staker1BalanceAfterRebase).eq(initialHoldings);
    });
  });

  describe("approve", () => {
    it("Sets the allowed value between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await yieldy
        .connect(staker1Signer as Signer)
        .approve(stakingContractMock, 10);
      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(10);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      );

      await expect(
        await yieldy
          .connect(staker1Signer as Signer)
          .approve(stakingContractMock, 10)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 10);
    });
  });

  describe("permit", () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: "istanbul",
        mnemonic: "horn horn horn horn horn horn horn horn horn horn horn horn",
        gasLimit: 9999999,
      },
    });
    const [wallet, other] = provider.getWallets();
    it("Allows permit", async () => {
      const nonce = await yieldy.nonces(wallet.address);
      const deadline = BigNumber.from(9999999999999);
      const testAmount = BigNumber.from(100000);
      const digest = await getApprovalDigest(
        yieldy,
        { owner: wallet.address, spender: other.address, value: testAmount },
        nonce,
        deadline
      );

      const { v, r, s } = ecsign(
        Buffer.from(digest.slice(2), "hex"),
        Buffer.from(wallet.privateKey.slice(2), "hex")
      );

      await expect(
        yieldy.permit(
          wallet.address,
          other.address,
          testAmount,
          deadline,
          v,
          hexlify(r),
          hexlify(s)
        )
      )
        .to.emit(yieldy, "Approval")
        .withArgs(wallet.address, other.address, testAmount);

      expect(await yieldy.nonces(wallet.address)).to.eq(BigNumber.from(1));
      expect(await yieldy.allowance(wallet.address, other.address)).to.eq(
        testAmount
      );
    });
  });

  describe("increaseAllowance", () => {
    it("Increases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await yieldy
        .connect(staker1Signer)
        .increaseAllowance(stakingContractMock, 4);

      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(14);
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await yieldy
          .connect(staker1Signer)
          .increaseAllowance(stakingContractMock, 4)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 14);
    });
  });

  describe("decreaseAllowance", () => {
    it("Decreases the allowance between sender and spender", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await yieldy
        .connect(staker1Signer)
        .decreaseAllowance(stakingContractMock, 4);

      expect(await yieldy.allowance(staker1, stakingContractMock)).to.equal(6);
    });
    it("Will not make the value negative", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        yieldy.connect(staker1Signer).decreaseAllowance(stakingContractMock, 11)
      ).to.be.revertedWith("ERC20: decreased allowance below zero");
    });
    it("Emits an Approval event", async () => {
      const { staker1, stakingContractMock } = await getNamedAccounts();
      const staker1Signer = accounts.find(
        (account) => account.address === staker1
      ) as Signer;

      await yieldy.connect(staker1Signer).approve(stakingContractMock, 10);
      await expect(
        await yieldy
          .connect(staker1Signer)
          .decreaseAllowance(stakingContractMock, 4)
      )
        .to.emit(yieldy, "Approval")
        .withArgs(staker1, stakingContractMock, 6);
    });
  });

  describe("mint", () => {
    it("can only be called by accounts with MINTER_BURNER_ROLE", async () => {
      const minterRole = await yieldy.MINTER_BURNER_ROLE();
      await expect(
        yieldy.mint(accounts[1].address, ethers.utils.parseUnits("100", 18))
      ).to.be.revertedWith(
        `AccessControl: account ${accounts[0].address.toLowerCase()} is missing role ${minterRole}`
      );
      yieldy.grantRole(minterRole, accounts[0].address);
      const mintAmount = ethers.utils.parseUnits("100", 18);
      yieldy.mint(accounts[1].address, mintAmount);
      const balance = await yieldy.balanceOf(accounts[1].address);
      expect(mintAmount).to.be.eq(balance);
      expect(await yieldy.totalSupply()).to.be.equal(balance);
    });
  });

  describe("burn", () => {
    it("can only be called by accounts with MINTER_BURNER_ROLE", async () => {
      const minterRole = await yieldy.MINTER_BURNER_ROLE();
      await expect(
        yieldy.burn(accounts[1].address, ethers.utils.parseUnits("100", 18))
      ).to.be.revertedWith(
        `AccessControl: account ${accounts[0].address.toLowerCase()} is missing role ${minterRole}`
      );
      yieldy.grantRole(minterRole, accounts[0].address);
      const mintAmount = ethers.utils.parseUnits("100", 18);
      yieldy.mint(accounts[1].address, mintAmount);
      const balance = await yieldy.balanceOf(accounts[1].address);

      // now we should be able to burn some amount
      yieldy.burn(accounts[1].address, mintAmount.div(2));
      const balanceAfterBurn = await yieldy.balanceOf(accounts[1].address);

      expect(mintAmount.div(2)).to.be.eq(balanceAfterBurn);
      expect(await yieldy.totalSupply()).to.be.equal(balance.div(2));
    });
  });
});
