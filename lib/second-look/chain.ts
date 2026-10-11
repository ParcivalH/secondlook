import { getAllowanceModuleDeployment } from "@safe-global/safe-modules-deployments";
import { parseAbi } from "viem";
import { CHAIN_ID } from "@/lib/config";
import { findToken } from "@/lib/tokens";

/** Second Look moves USDC. Same token as lib/tokens.ts. */
export const USDC = findToken("USDC")!;

/** Safe Allowance Module on Sepolia: the on-chain daily limit Dad can spend alone. */
export const ALLOWANCE_MODULE = (getAllowanceModuleDeployment({ network: String(CHAIN_ID) })?.networkAddresses[String(CHAIN_ID)] ??
  "0xCFbFaC74C26F8647cBDb8c5caf80BB5b32E43134") as `0x${string}`;

export const DAILY_RESET_MIN = 24 * 60;

export const allowanceAbi = parseAbi([
  "function addDelegate(address delegate)",
  "function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)",
  "function getTokenAllowance(address safe, address delegate, address token) view returns (uint256[5])",
  "function executeAllowanceTransfer(address safe, address token, address to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes signature)",
]);

export const safeModuleAbi = parseAbi([
  "function enableModule(address module)",
  "function isModuleEnabled(address module) view returns (bool)",
]);
