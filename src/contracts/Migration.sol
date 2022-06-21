// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";

import "../interfaces/IStakingV1.sol";
import "../interfaces/IStaking.sol";
import "../interfaces/IYieldy.sol";

contract Migration {
    using SafeERC20Upgradeable for IERC20Upgradeable;

    address public immutable OLD_CONTRACT;
    address public immutable NEW_CONTRACT;
    address public immutable OLD_YIELDY_TOKEN;

    constructor(address _oldContract, address _newContract) {
        // addresses can't be 0x0
        require(
            _oldContract != address(0) && _newContract != address(0),
            "Invalid address"
        );

        OLD_CONTRACT = _oldContract;
        NEW_CONTRACT = _newContract;

        OLD_YIELDY_TOKEN = IStakingV1(_oldContract).REWARD_TOKEN();
        address stakingToken = IStaking(_newContract).STAKING_TOKEN();

        IYieldy(OLD_YIELDY_TOKEN).approve(_oldContract, type(uint256).max);
        IERC20Upgradeable(stakingToken).approve(
            _newContract,
            type(uint256).max
        );
    }

    /**
        @notice unstake user's FOXy from the old Staking contract and immediately
        restake into the upgraded one
        Note: user needs to approve reward token spend before calling this
     */
    function moveFundsToUpgradedContract() external {
        uint256 userWalletBalance = IYieldy(OLD_YIELDY_TOKEN).balanceOf(
            msg.sender
        );

        IYieldy(OLD_YIELDY_TOKEN).transferFrom(
            msg.sender,
            address(this),
            userWalletBalance
        );

        IStaking(OLD_CONTRACT).instantUnstake(false);

        IStaking(NEW_CONTRACT).stake(userWalletBalance, msg.sender);
    }
}
