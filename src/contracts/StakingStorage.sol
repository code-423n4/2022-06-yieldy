// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "../structs/Claim.sol";
import "../structs/Epoch.sol";

contract StakingStorage {
    address public TOKE_POOL;
    address public TOKE_MANAGER;
    address public TOKE_REWARD;
    address public STAKING_TOKEN;
    address public YIELDY_TOKEN;
    address public TOKE_TOKEN;
    address public LIQUIDITY_RESERVE;
    address public FEE_ADDRESS; // can be address(0)
    address public CURVE_POOL; // can be address(0)

    address public COW_SETTLEMENT;
    address public COW_RELAYER;

    // owner overrides
    bool public isStakingPaused; // pauses staking
    bool public isUnstakingPaused; // pauses unstaking & instantUnstake
    bool public isInstantUnstakingPaused; // pauses instantUnstake

    Epoch public epoch;

    mapping(address => Claim) public warmUpInfo;
    mapping(address => Claim) public coolDownInfo;

    uint256 public timeLeftToRequestWithdrawal; // time (in seconds) before TOKE cycle ends to request withdrawal
    uint256 public warmUpPeriod; // amount of epochs to delay warmup vesting
    uint256 public coolDownPeriod; // amount of epochs to delay cooldown vesting
    uint256 public requestWithdrawalAmount; // amount of staking tokens to request withdrawal once able to send
    uint256 public withdrawalAmount; // amount of stakings tokens available for withdrawal
    uint256 public lastTokeCycleIndex; // last tokemak cycle index which requested withdrawals
    uint256 public affiliateFee; // fee to send TOKE rewards

    uint256 public constant BASIS_POINTS = 10000; // 100% in basis points

    int128 public curvePoolFrom;
    int128 public curvePoolTo;
}
