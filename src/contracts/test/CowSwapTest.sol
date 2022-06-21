// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../../interfaces/ICowSettlement.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// only used to test presigning with cow protocol
contract CowSwapTest {
    constructor() {
        // approve rinkeby dai
        IERC20(0x5592EC0cfb4dbc12D3aB100b257153436a1f0FEa).approve(
            0xC92E8bdf79f0507f65a392b0ab4667716BFE0110,
            type(uint256).max
        );
    }

    /**
     * @notice trades rewards generated from claimFromTokemak for staking token, then calls addRewardsForStakers
     * @dev this is function is called from claimFromTokemak if the autoRebase bool is set to true
     */
    function preSign(bytes calldata orderUid) external {
        // sign settlement contract
        ICowSettlement(0x9008D19f58AAbD9eD0D60971565AA8510560ab41)
            .setPreSignature(orderUid, true);
    }
}
