# ✨ So you want to sponsor a contest

This `README.md` contains a set of checklists for our contest collaboration.

Your contest will use two repos: 
- **a _contest_ repo** (this one), which is used for scoping your contest and for providing information to contestants (wardens)
- **a _findings_ repo**, where issues are submitted. 

Ultimately, when we launch the contest, this contest repo will be made public and will contain the smart contracts to be reviewed and all the information needed for contest participants. The findings repo will be made public after the contest is over and your team has mitigated the identified issues.

Some of the checklists in this doc are for **C4 (🐺)** and some of them are for **you as the contest sponsor (⭐️)**.

---

# Contest setup

## ⭐️ Sponsor: Provide contest details

Under "SPONSORS ADD INFO HERE" heading below, include the following:

- [ ] Name of each contract and:
  - [ ] source lines of code (excluding blank lines and comments) in each
  - [ ] external contracts called in each
  - [ ] libraries used in each
- [ ] Describe any novel or unique curve logic or mathematical models implemented in the contracts
- [ ] Does the token conform to the ERC-20 standard? In what specific ways does it differ?
- [ ] Describe anything else that adds any special logic that makes your approach unique
- [ ] Identify any areas of specific concern in reviewing the code
- [ ] Add all of the code to this repo that you want reviewed
- [ ] Create a PR to this repo with the above changes.

---

# Contest prep

## ⭐️ Sponsor: Contest prep
- [ ] Make sure your code is thoroughly commented using the [NatSpec format](https://docs.soliditylang.org/en/v0.5.10/natspec-format.html#natspec-format).
- [ ] Modify the bottom of this `README.md` file to describe how your code is supposed to work with links to any relevent documentation and any other criteria/details that the C4 Wardens should keep in mind when reviewing. ([Here's a well-constructed example.](https://github.com/code-423n4/2021-06-gro/blob/main/README.md))
- [ ] Please have final versions of contracts and documentation added/updated in this repo **no less than 24 hours prior to contest start time.**
- [ ] Ensure that you have access to the _findings_ repo where issues will be submitted.
- [ ] Promote the contest on Twitter (optional: tag in relevant protocols, etc.)
- [ ] Share it with your own communities (blog, Discord, Telegram, email newsletters, etc.)
- [ ] Optional: pre-record a high-level overview of your protocol (not just specific smart contract functions). This saves wardens a lot of time wading through documentation.
- [ ] Delete this checklist and all text above the line below when you're ready.

---

# Yieldy contest details
- $47,500 USDC main award pot
- $2,500 USDC gas optimization award pot
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2022-06-yieldy-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts June 21, 2022 20:00 UTC
- Ends June 26, 2022 19:59 UTC

This repo will be made public before the start of the contest. (C4 delete this line when made public)

## Glossary

| Name | Description |
| -------- | -------- |
| Tokemak | Protocol that allows for single sided asset staking to receive rewards in TOKE (https://www.tokemak.xyz/) |
| Rebasing Token | A cryptocurrency whose supply is algorithmically adjusted in order to control its price |
| Staking Token | Our own terminology of the underlying asset of the yieldy.  For example, if you staking USDC and received the yieldy USDCy, then USDC would the be Staking token and USDCy would be the Rebasing token |


## Protocol overview

Yieldy is a protocol that enables multiple rebasing tokens that allows for single sided staking with compounding interest through the use of investing in Tokemak.

These contracts can be used with any asset that Tokemak supports on the Ethereum network.

When a user stakes a token to the Yieldy Staking smart contract, the contract invests the staking token into Tokemak.  Once this happens a new yieldy token is minted to the user that is represented 1:1 to the staking asset. Tokemak is currently on week long reward cycles, and once TOKE rewards are generated we can claim the rewards to the Staking contract.  Once the rewards are in the staking contract, the contract owners can either manually or automatically convert the TOKE rewards into the staking asset and stake them back into the system for a future rebase.

Currently, it takes a full cycles to unstake from Tokemak, so to unstake through the Yieldy protocol it can take some time.  We solved this issue in two ways.  The first way was to utilize the LiquidityReserve contract to enable single sided staking where users can gain fees from providing liquidity for instant unstaking.  The second way we solved this problem was to implement Curve and trade directly from the yieldy token to the staking asset.  This will work for assets that have liquidity for their yieldy counterpart on Curve, but if not, we have the LiquidityReserve to fall back on.

## Smart Contracts

# Staking (476 sloc)

Staking contract that handles stake, unstake, instantUnstake, as well as claiming and rebasing rewards.

This contract inherits the following OZ contracts:
- "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol"
# Yieldy (172 sloc)

ERC-20 rebasing token that is used 1:1 to represent the staking asset.

This contract inherits the following OZ contracts:
- "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
- "@openzeppelin/contracts/token/ERC20/IERC20.sol";

# Migration (39 sloc)

Will be used to migrate FOXy into a Yieldy asset.  Find out more on FOXy here: https://github.com/shapeshift/foxy
# LiquidityReserve (154 sloc)

Single sided staking contract that allos for users to add tokens to provide liquidity for the Staking contract to allow users to instantly unstake vs having to wait on Tokemaks cycles to clear before allowing users to get their funds.
# BatchRequests (51 sloc)

Every Tokemak cycle we will need to call `sendWithdrawalRequests` from each of the Staking contracts.  This will allow us to call that function on all of the Yieldy contracts at once allowing us to have only one bot that maintains this.

# Libraries

- ERC20Upgradeable.sol - only two lines are differen from the OZ version.  Made _allowances and _totalSupply internal instead of private.
- ERC20PermitUpgradeable.sol - based of OZ's (token/ERC20/extensions/draft-ERC20Permit.sol).  Changed to use our own ERC20Upgradeable.sol

## Local development

### Run Tests

1. `yarn`
2. `yarn compile`
3. `yarn test` or `yarn coverage` will run the basic test examples.

### Other Commands

`yarn local-node` - used to run your own forked mainnet node locally

`yarn local-init` - used to initialize local-node and set up the FOXy contracts to use locally

`yarn local-mine` - used to mine to the next Tokemak cycle as well as sendWithdrawalRequests and rebase



