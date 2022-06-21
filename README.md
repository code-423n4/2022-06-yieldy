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
| Warmup Period | An optional time to delay the user receiving minted tokens.  This functionality was created in case someone front runs the tx's |
| Cooldown Period | A period to delay the withdraw of unstaked tokens.  This is used because funds need to wait a certain time period to be released from Tokemak |


## Protocol overview

Yieldy is a protocol that creates a rebasing token for assets that have a Tokemak reactor.  For each asset that Tokemak supports, we can create a Yieldy token for that asset.  For instance, for USDC we will create USDCy, Fox will have a FOXy and so on.  This allows for single sided staking with compounding interest through the use of depositing into Tokemak reactors.

Yieldy is based on a previous set of contracts we completed called FOXy.  Find out more on FOXy here: https://github.com/shapeshift/foxy

These contracts can be used with any asset that Tokemak supports on the Ethereum network.

When a user stakes a token to the Yieldy Staking smart contract, the contract invests the staking token into Tokemak.  Once this happens a new yieldy token is minted to the user which is represented 1:1 to the staking asset. Tokemak is currently on week long reward cycles, and once TOKE rewards are generated we can claim the rewards to the Staking contract.  Once the rewards are in the staking contract, the contract owners can either manually or automatically convert the TOKE rewards into the staking asset and stake them back into the system for a future rebase.  When the smart contract has extra tokens from rewards and a rebase occurs, the rewards are distributed to all holders and the balance of their yieldy token increases directly in their wallet.  Rebases can only go up, never down.

Currently, it takes a full cycles to unstake from Tokemak, so to unstake through the Yieldy protocol it can take some time.  We solved this issue in two ways.  The first way was to utilize the LiquidityReserve contract to enable single sided staking where users can gain fees from providing liquidity for instant unstaking.  The second way we solved this problem was to implement Curve and trade directly from the yieldy token to the staking asset.  This will work for assets that have liquidity for their yieldy counterpart on Curve, but if not, we have the LiquidityReserve to fall back on.

## Smart Contracts

### Staking (476 sloc)

Staking contract that handles stake, unstake, instantUnstake, as well as claiming and rebasing rewards.

- Stake: Stakes users staking token into Tokemak, then mints a new rebasing token to the users address
- Unstake: Updates amount to send a `withdrawRequest` to Tokemak.
- Withdraw Requests: This happens once a week and we batch all unstakes to Tokemak before the next cycle with `sendWithdrawalRequests`.  Once the next cycle rolls over, the user is able to `claimWithdraw` their funds they previously unstaked.
- Instant Unstake:
  - Liquidity Reserve: Immediately trades, if funds are available, the rebasing token for the staking token through the reserve contract for a fee. 
  - Curve: Immediately trades, if pool and liquidity is available, the rebasing token for the staking token through the Curve factory pool. 
- Claim Rewards:  Rewards are claimed from Tokemak through `claimFromTokemak`.  The signatures are generated through Tokemaks ipfs and when this function is called Tokemak will transfer `TOKE` rewards to the `Staking` contract


This contract inherits the following OZ contracts:
- "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol"
  
### Yieldy (172 sloc)

ERC-20 rebasing token that is used 1:1 to represent the staking asset.

Rebasing updates the total supply of the Yieldy contract by calculating rebasing credits by using the current total supply and rewards that were added into the system.

This contract inherits the following OZ contracts:
- "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
- "@openzeppelin/contracts/token/ERC20/IERC20.sol";

### Migration (39 sloc)

Will be used to migrate FOXy into a Yieldy asset.

### LiquidityReserve (154 sloc)

Single sided staking contract that allos for users to add tokens to provide liquidity for the Staking contract to allow users to instantly unstake vs having to wait on Tokemaks cycles to clear before allowing users to get their funds.

This contract inherits the following OZ contracts:
- "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
- "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol"

### BatchRequests (51 sloc)

Every Tokemak cycle we will need to call `sendWithdrawalRequests` from each of the Staking contracts.  This will allow us to call that function on all of the Yieldy contracts at once allowing us to have only one bot that maintains this.

This contract inherits the following OZ contracts:
- "@openzeppelin/contracts/access/Ownable.sol";

### Libraries

- ERC20Upgradeable.sol - only two lines are differen from the OZ version.  Made _allowances and _totalSupply internal instead of private.
- ERC20PermitUpgradeable.sol - based of OZ's (token/ERC20/extensions/draft-ERC20Permit.sol).  Changed to use our own ERC20Upgradeable.sol

## Potential Protocol concerns

### Trust Model

The owner of these contracts will be the ShapeShift DAO's multisig.  The DAO must be considered a trusted party for these contracts to be valid, otherwise the TOKE rewards could be stolen.  Also, because these contracts are upgradeable, there is potential for future vulnerabilites to be implemented

## Local development

### Run Tests

1. `yarn`
2. `yarn compile`
3. `yarn test` or `yarn coverage` will run the basic test examples.

### Other Commands

`yarn local-node` - used to run your own forked mainnet node locally

`yarn local-init` - used to initialize local-node and set up the FOXy contracts to use locally

`yarn local-mine` - used to mine to the next Tokemak cycle as well as sendWithdrawalRequests and rebase



