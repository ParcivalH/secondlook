export type Token = {
  symbol: string;
  decimals: number;
  address: `0x${string}` | null; 
  dailyAllowance: string; 
};

export const TOKENS: Token[] = [
  { symbol: "ETH", decimals: 18, address: null, dailyAllowance: "0.05" },
  { symbol: "USDC", decimals: 6, address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", dailyAllowance: "200" },
];

export function findToken(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol === symbol);
}