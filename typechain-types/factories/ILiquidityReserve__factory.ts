/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Signer, utils } from "ethers";
import { Provider } from "@ethersproject/providers";
import type {
  ILiquidityReserve,
  ILiquidityReserveInterface,
} from "../ILiquidityReserve";

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_stakingContract",
        type: "address",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "amount_",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_recipient",
        type: "address",
      },
    ],
    name: "instantUnstake",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "uint256",
        name: "_fee",
        type: "uint256",
      },
    ],
    name: "setFee",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export class ILiquidityReserve__factory {
  static readonly abi = _abi;
  static createInterface(): ILiquidityReserveInterface {
    return new utils.Interface(_abi) as ILiquidityReserveInterface;
  }
  static connect(
    address: string,
    signerOrProvider: Signer | Provider
  ): ILiquidityReserve {
    return new Contract(address, _abi, signerOrProvider) as ILiquidityReserve;
  }
}
