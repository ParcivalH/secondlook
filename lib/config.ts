export const CHAIN_ID = 11155111;

// Pending transfers expire after 24h: doing nothing never sends money
export const EXPIRY_MS = 24 * 60 * 60 * 1000;

export const safeQueueUrl = (safe: string) => `https://app.safe.global/transactions/queue?safe=sep:${safe}`;
export const etherscanTxUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;