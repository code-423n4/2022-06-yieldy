// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IYieldy is IERC20 {
    function rebase(uint256 _profit, uint256 _epoch) external;

    function creditsForTokenBalance(uint256 _amount)
        external
        view
        returns (uint256);

    function tokenBalanceForCredits(uint256 _credits)
        external
        view
        returns (uint256);

    function index() external view returns (uint256);

    function mint(address _address, uint256 _amount) external;

    function burn(address _address, uint256 _amount) external;
}
