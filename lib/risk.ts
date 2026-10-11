// Agent risk check (Figma section 2). Rules-based for now; the AI agent will plug in here later.
// Rule from Figma: the agent can only ESCALATE risk, never downgrade it.
import { parseUnits } from "viem";
import type { Token } from "./tokens";

export type RiskLevel = "green" | "yellow" | "red";

export type RiskInput = {
  token: Token;
  amount: string;
  firstTimeAddress: boolean; // never sent to this address from the Safe before
  addressPasted: boolean; // behavior signal from the form
  amountEdits: number; // behavior signal from the form
  hour: number; // owner's local hour, 0-23
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

  // Figma hard rule: anything above the daily allowance needs the guardian -> red
  const level: RiskLevel = overAllowance || signals.length >= 2 ? "red" : signals.length === 1 ? "yellow" : "green";
  return { level, signals };
}
