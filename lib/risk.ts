import { parseUnits } from "viem";
import type { Token } from "./tokens";

export type RiskLevel = "green" | "yellow" | "red";

export type RiskInput = {
  token: Token;
  amount: string;
  firstTimeAddress: boolean; 
  addressPasted: boolean; 
  amountEdits: number; 
  hour: number; 
};

export type RiskResult = { level: RiskLevel; signals: string[] };

export function assessRisk(i: RiskInput): RiskResult {
  const signals: string[] = [];
  const overAllowance = parseUnits(i.amount, i.token.decimals) > parseUnits(i.token.dailyAllowance, i.token.decimals);

  if (overAllowance) signals.push(`Over the daily allowance (${i.token.dailyAllowance} ${i.token.symbol})`);
  if (i.firstTimeAddress) signals.push("First-time address");
  if (i.addressPasted) signals.push("Address was pasted");
  if (i.amountEdits >= 3) signals.push("Amount edited repeatedly");
  if (i.hour < 6) signals.push("Late night (0-6am)");

  const level: RiskLevel = overAllowance || signals.length >= 2 ? "red" : signals.length === 1 ? "yellow" : "green";
  return { level, signals };
}