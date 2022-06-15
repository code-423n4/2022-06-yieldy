// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../LiquidityReserve.sol";

contract LiquidityReserveV2Test is LiquidityReserve {
    /**
        @notice new function to test
     */
    function newFunction() public pure returns (uint256) {
        return 987654321;
    }
}
