// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../Staking.sol";

contract StakingV2Test is Staking {
    /**
        @notice new function to test
     */
    function newFunction() public pure returns (uint256) {
        return 123456789;
    }

    function sendAffiliateFee(uint256 _amount) external {
        _sendAffiliateFee(_amount);
    }
}
