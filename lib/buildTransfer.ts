import { encodeFunctionData, erc20Abi, getAddress, parseUnits } from "viem";
import type { Token } from "./tokens";

export function buildTransfer(token: Token, recipient: string, amount: string) {
  const to = getAddress(recipient);
  const units = parseUnits(amount, token.decimals);
  if (units <= BigInt(0)) throw new Error("Amount must be greater than 0");

  if (token.address === null) {
    return { to, value: units.toString(), data: "0x" as `0x${string}` };
  }
  return {
    to: token.address,
    value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, units] }),
  };
}