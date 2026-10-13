// Which token a Second Look transfer moves. Shared by the browser and the server.
// Token details (address, decimals, test price) come from lib/tokens.ts, the same list the Safe backend uses.
import { TOKENS, findToken, type Token } from "@/lib/tokens";

export type Sym = string;
export const SYMBOLS: Sym[] = TOKENS.map((t) => t.symbol);

/** Shown in the token list but not sendable yet (no contract wired up). */
export const COMING_SOON: { symbol: string; name: string }[] = [
  { symbol: "USDT", name: "Tether USD" },
  { symbol: "DAI", name: "Dai" },
  { symbol: "WBTC", name: "Wrapped Bitcoin" },
  { symbol: "WETH", name: "Wrapped Ether" },
  { symbol: "EURC", name: "Euro Coin" },
  { symbol: "LINK", name: "Chainlink" },
  { symbol: "UNI", name: "Uniswap" },
  { symbol: "AAVE", name: "Aave" },
];

/** Requests saved before tokens existed are USDC. */
export const symOf = (x: { token?: string }): Sym => (x.token && findToken(x.token) ? x.token : "USDC");
export const tokenOf = (sym: Sym): Token => findToken(sym)!;

/** The daily limit and the risk rules count value in USD (test prices; ETH/WETH can be set with NEXT_PUBLIC_ETH_PRICE_USD). */
const ETH_USD = Number(process.env.NEXT_PUBLIC_ETH_PRICE_USD ?? 0);
export const priceOf = (sym: Sym) => ((sym === "ETH" || sym === "WETH") && ETH_USD > 0 ? ETH_USD : (findToken(sym)?.usd ?? 1));
export const usd = (amount: number, sym: Sym) => amount * priceOf(sym);

/** For people: "0.05 ETH", "1,200 USDC". */
export const fmtAmount = (amount: number, sym: Sym) =>
  `${amount.toLocaleString("en-US", { maximumFractionDigits: tokenOf(sym).decimals > 6 ? 6 : 2 })} ${sym}`;

/** For the Safe transaction: an exact decimal string ("0.1", not "0.1000000000000000055"). Same on both sides. */
export const amountString = (amount: number, sym: Sym) =>
  amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: tokenOf(sym).decimals });

/** True if the amount has no more decimals than the token allows (USDC: 6). */
export const fitsDecimals = (amount: number, sym: Sym) => Number(amountString(amount, sym)) === amount;

/** USDC and ETH have their own fields (older saved data); every other token is in `balances`. */
export type Balances = { balance: number; ethBalance?: number; balances?: Record<string, number> };
export const balanceOf = (a: Balances, sym: Sym) => (sym === "USDC" ? a.balance : sym === "ETH" ? (a.ethBalance ?? 0) : (a.balances?.[sym] ?? 0));
export const totalUsd = (a: Balances) => SYMBOLS.reduce((sum, s) => sum + usd(balanceOf(a, s), s), 0);
