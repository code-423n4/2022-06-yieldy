// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.9;

interface ICowSettlement {
    function setPreSignature(bytes calldata orderUid, bool signed) external;
}
