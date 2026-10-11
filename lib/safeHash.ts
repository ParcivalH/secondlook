import { concat, hashDomain, hashStruct, keccak256, type Hex } from "viem";
import { CHAIN_ID } from "./config";

export type SafeTxFields = {
  to: string;
  value: string;
  data: string | null;
  operation: number;
  safeTxGas: string | number;
  baseGas: string | number;
  gasPrice: string | number;
  gasToken: string;
  refundReceiver?: string | null;
  nonce: string | number;
};

const ZERO = "0x0000000000000000000000000000000000000000";

const DOMAIN_TYPES = {
  EIP712Domain: [
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export function safeTxHashes(safeAddress: string, tx: SafeTxFields) {
  const domainSeparator = hashDomain({
    domain: { chainId: BigInt(CHAIN_ID), verifyingContract: safeAddress as Hex },
    types: DOMAIN_TYPES,
  });
  const structHash = hashStruct({
    primaryType: "SafeTx",
    types: SAFE_TX_TYPES,
    data: {
      to: tx.to as Hex,
      value: BigInt(tx.value),
      data: (tx.data || "0x") as Hex,
      operation: tx.operation,
      safeTxGas: BigInt(tx.safeTxGas),
      baseGas: BigInt(tx.baseGas),
      gasPrice: BigInt(tx.gasPrice),
      gasToken: (tx.gasToken || ZERO) as Hex,
      refundReceiver: (tx.refundReceiver || ZERO) as Hex,
      nonce: BigInt(tx.nonce),
    },
  });
  const safeTxHash = keccak256(concat(["0x19", "0x01", domainSeparator, structHash]));
  return { domainSeparator, structHash, safeTxHash };
}