// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../structs/Rebase.sol";

contract YieldyStorage {
    address public stakingContract;
    Rebase[] public rebases;
    uint256 public index;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN");
    bytes32 public constant MINTER_BURNER_ROLE =
        keccak256("MINTER_BURNER_ROLE");
    bytes32 public constant REBASE_ROLE = keccak256("REBASE_ROLE");

    uint256 internal WAD;
    uint256 internal constant MAX_UINT256 = ~uint256(0);

    uint256 internal constant MAX_SUPPLY = ~uint128(0); // (2^128) - 1
    uint256 public rebasingCreditsPerToken; // gonsPerFragment (fragment == 1 token)
    uint256 public rebasingCredits; // total credits in system
    mapping(address => uint256) public creditBalances; // gonBalances (gon == credit)

    uint8 internal decimal;
}
