// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

struct Rebase {
    uint256 epoch;
    uint256 rebase;
    uint256 totalStakedBefore;
    uint256 totalStakedAfter;
    uint256 amountRebased;
    uint256 index;
    uint256 blockNumberOccurred;
}
