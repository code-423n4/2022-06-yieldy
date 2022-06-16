// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "../interfaces/IStaking.sol";
import "../interfaces/ILiquidityReserve.sol";
import "./LiquidityReserveStorage.sol";

contract LiquidityReserve is
    LiquidityReserveStorage,
    ERC20Upgradeable,
    OwnableUpgradeable,
    ILiquidityReserve
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event FeeChanged(uint256 fee);

    // check if sender is the stakingContract
    modifier onlyStakingContract() {
        require(msg.sender == stakingContract, "Not staking contract");
        _;
    }

    /**
        @notice initialize by setting stakingContract & setting initial liquidity
        @param _tokenName name of the lrToken to be created
        @param _tokenSymbol symbol of the lrToken to be created.
        @param _stakingToken the staking token in use
        @param _rewardToken the reward token in use
     */
    function initialize(
        string memory _tokenName,
        string memory _tokenSymbol,
        address _stakingToken,
        address _rewardToken
    ) external initializer {
        ERC20Upgradeable.__ERC20_init(_tokenName, _tokenSymbol);
        OwnableUpgradeable.__Ownable_init();
        require(
            _stakingToken != address(0) && _rewardToken != address(0),
            "Invalid address"
        );
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
    }

    /**
        @notice callable once after initialized by the owner to set the staking contract and enable
        our reserve to be used.
        @param _stakingContract address of the staking contract
     */
    function enableLiquidityReserve(address _stakingContract)
        external
        onlyOwner
    {
        require(!isReserveEnabled, "Already enabled");
        require(_stakingContract != address(0), "Invalid address");

        uint256 stakingTokenBalance = IERC20Upgradeable(stakingToken).balanceOf(
            msg.sender
        );
        // require address has minimum liquidity
        require(
            stakingTokenBalance >= MINIMUM_LIQUIDITY,
            "Not enough staking tokens"
        );
        stakingContract = _stakingContract;

        // permanently lock the first MINIMUM_LIQUIDITY of lrTokens
        IERC20Upgradeable(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            MINIMUM_LIQUIDITY
        );
        _mint(address(this), MINIMUM_LIQUIDITY);
        IERC20Upgradeable(rewardToken).approve(
            stakingContract,
            type(uint256).max
        );
        isReserveEnabled = true;
    }

    /**
        @notice sets Fee (in basis points eg. 100 bps = 1%) for instant unstaking
        @param _fee uint - fee in basis points
     */
    function setFee(uint256 _fee) external onlyOwner {
        // check range before setting fee
        require(_fee <= BASIS_POINTS, "Out of range");
        fee = _fee;

        emit FeeChanged(_fee);
    }

    /**
        @notice addLiquidity for the stakingToken and receive lrToken in exchange
        @param _amount uint - amount of staking tokens to add
     */
    function addLiquidity(uint256 _amount) external {
        require(isReserveEnabled, "Not enabled yet");
        uint256 stakingTokenBalance = IERC20Upgradeable(stakingToken).balanceOf(
            address(this)
        );
        uint256 rewardTokenBalance = IERC20Upgradeable(rewardToken).balanceOf(
            address(this)
        );
        uint256 lrFoxSupply = totalSupply();
        uint256 coolDownAmount = IStaking(stakingContract)
            .coolDownInfo(address(this))
            .amount;
        uint256 totalLockedValue = stakingTokenBalance +
            rewardTokenBalance +
            coolDownAmount;

        uint256 amountToMint = (_amount * lrFoxSupply) / totalLockedValue;
        IERC20Upgradeable(stakingToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );
        _mint(msg.sender, amountToMint);
    }

    /**
        @notice calculate current lrToken withdraw value
        @param _amount uint - amount of tokens that will be withdrawn
        @return uint - converted amount of staking tokens to withdraw from lr tokens
     */
    function _calculateReserveTokenValue(uint256 _amount)
        internal
        view
        returns (uint256)
    {
        uint256 lrFoxSupply = totalSupply();
        uint256 stakingTokenBalance = IERC20Upgradeable(stakingToken).balanceOf(
            address(this)
        );
        uint256 rewardTokenBalance = IERC20Upgradeable(rewardToken).balanceOf(
            address(this)
        );
        uint256 coolDownAmount = IStaking(stakingContract)
            .coolDownInfo(address(this))
            .amount;
        uint256 totalLockedValue = stakingTokenBalance +
            rewardTokenBalance +
            coolDownAmount;
        uint256 convertedAmount = (_amount * totalLockedValue) / lrFoxSupply;

        return convertedAmount;
    }

    /**
        @notice removeLiquidity by swapping your lrToken for stakingTokens
        @param _amount uint - amount of tokens to remove from liquidity reserve
     */
    function removeLiquidity(uint256 _amount) external {
        // check balance before removing liquidity
        require(_amount <= balanceOf(msg.sender), "Not enough lr tokens");
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));

        uint256 amountToWithdraw = _calculateReserveTokenValue(_amount);

        // verify that we have enough stakingTokens
        require(
            IERC20Upgradeable(stakingToken).balanceOf(address(this)) >=
                amountToWithdraw,
            "Not enough funds"
        );

        _burn(msg.sender, _amount);
        IERC20Upgradeable(stakingToken).safeTransfer(
            msg.sender,
            amountToWithdraw
        );
    }

    /**
        @notice allow instant unstake their stakingToken for a fee paid to the liquidity providers
        @param _amount uint - amount of tokens to instantly unstake
        @param _recipient address - address to send staking tokens to
     */
    function instantUnstake(uint256 _amount, address _recipient)
        external
        onlyStakingContract
    {
        require(isReserveEnabled, "Not enabled yet");
        // claim the stakingToken from previous unstakes
        IStaking(stakingContract).claimWithdraw(address(this));

        uint256 amountMinusFee = _amount - ((_amount * fee) / BASIS_POINTS);

        IERC20Upgradeable(rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        IERC20Upgradeable(stakingToken).safeTransfer(
            _recipient,
            amountMinusFee
        );
        unstakeAllRewardTokens();
    }

    /**
        @notice find balance of reward tokens in contract and unstake them from staking contract
     */
    function unstakeAllRewardTokens() public {
        require(isReserveEnabled, "Not enabled yet");
        uint256 coolDownAmount = IStaking(stakingContract)
            .coolDownInfo(address(this))
            .amount;
        if (coolDownAmount == 0) {
            uint256 amount = IERC20Upgradeable(rewardToken).balanceOf(
                address(this)
            );
            if (amount > 0) IStaking(stakingContract).unstake(amount, false);
        }
    }
}
