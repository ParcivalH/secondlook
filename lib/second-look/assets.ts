// Which token a Second Look transfer moves. Shared by the browser and the server.
// Token details (address, decimals) come from lib/tokens.ts, the same list the Safe backend uses.
import { findToken, type Token } from "@/lib/tokens";

export type Sym = "USDC" | "ETH";
export const SYMBOLS: Sym[] = ["USDC", "ETH"];

/** Requests saved before tokens existed are USDC. */
export const symOf = (x: { token?: string }): Sym => (x.token === "ETH" ? "ETH" : "USDC");
export const tokenOf = (sym: Sym): Token => findToken(sym)!;

/** The daily limit and the risk rules count value in USD. Test ETH uses a fixed price. */
export const ETH_USD = Number(process.env.NEXT_PUBLIC_ETH_PRICE_USD ?? 2500);
export const usd = (amount: number, sym: Sym) => (sym === "ETH" ? amount * ETH_USD : amount);

/** For people: "0.05 ETH", "1,200 USDC". */
export const fmtAmount = (amount: number, sym: Sym) =>
  `${amount.toLocaleString("en-US", { maximumFractionDigits: sym === "ETH" ? 6 : 2 })} ${sym}`;

/** For the Safe transaction: an exact decimal string ("0.1", not "0.1000000000000000055"). Same on both sides. */
export const amountString = (amount: number, sym: Sym) =>
  amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: tokenOf(sym).decimals });

/** True if the amount has no more decimals than the token allows (USDC: 6). */
export const fitsDecimals = (amount: number, sym: Sym) => Number(amountString(amount, sym)) === amount;
