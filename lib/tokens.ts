// Tokens the owner can send from the Safe (Ethereum Sepolia testnet).
export type Token = {
  symbol: string;
  decimals: number;
  address: `0x${string}` | null; // null = native ETH
  dailyAllowance: string; // amount above which a transfer is treated as large (Figma: 200 USDC a day)
};

export const TOKENS: Token[] = [
  { symbol: "ETH", decimals: 18, address: null, dailyAllowance: "0.05" },
  // Circle's official test USDC on Sepolia (free from https://faucet.circle.com)
  { symbol: "USDC", decimals: 6, address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", dailyAllowance: "200" },
];

export function findToken(symbol: string): Token | undefined {
  return TOKENS.find((t) => t.symbol === symbol);
}
