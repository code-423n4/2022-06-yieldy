// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ICurvePool {
    function exchange(
        int128 _from, // index of from coin (use coins to get index)
        int128 _to, // index of to coin (use coins to get index)
        uint256 _dx, // amount of i being exchanged
        uint256 _min_dy, // minimum amount of j to receive
        address _recipient // address to send staking token to
    ) external returns (uint256); // returns actual amount of coins received

    function get_dy(
        int128 _from, // index of from coin (use coins to get index)
        int128 _to, // index of to coin (use coins to get index)
        uint256 _dx // amount of i being exchanged
    ) external view returns (uint256); // estimated amount of coin j that user will receive

    function fee() external view returns (uint256);

    function coins(uint256 index) external view returns (address);
}
