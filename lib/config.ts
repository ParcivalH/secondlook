export const CHAIN_ID = 11155111;
export const SAFE_ADDRESS = process.env.NEXT_PUBLIC_SAFE_ADDRESS as `0x${string}`;


export const OWNER_NAME = "Dad";
export const GUARDIAN_NAME = "Mia";

export const EXPIRY_MS = 24 * 60 * 60 * 1000;

export const safeQueueUrl = () => `https://app.safe.global/transactions/queue?safe=sep:${SAFE_ADDRESS}`;
export const etherscanTxUrl = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;