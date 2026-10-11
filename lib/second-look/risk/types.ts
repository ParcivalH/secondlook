export type Tier = "green" | "yellow" | "red";

export interface Contact {
  addr: string;
  label: string;
}

export interface PastTransfer {
  addr: string;
  amount: number;
  /** Unix ms */
  ts: number;
}

/** What the owner is trying to send. Amounts are in whole token units (USDC). */
export interface TransferDraft {
  to: string;
  amount: number;
  label?: string;
  /** True when the address was pasted rather than picked from contacts. */
  pasted?: boolean;
}

/** Everything the risk engine is allowed to know. All of it is local or on-chain data; none of it comes from the AI. */
export interface AccountContext {
  dailyLimit: number;
  balance: number;
  allowlist: Contact[];
  history: PastTransfer[];
  /** Lower-cased addresses from a reported-scam list. */
  flagged?: string[];
  /** Days since the recipient address first appeared on-chain, if known. */
  recipientAgeDays?: number;
  /** Unix ms. Passed in so the engine is deterministic and testable. */
  now: number;
  /** Owner's local hour (0–23). Defaults to the hour of `now` in UTC. */
  localHour?: number;
}

export type SignalCode =
  | "OVER_LIMIT"
  | "FLAGGED_ADDRESS"
  | "NEW_ADDRESS"
  | "FRESH_ADDRESS"
  | "SMALL_THEN_LARGE"
  | "BURST_TO_NEW"
  | "LARGE_VS_USUAL"
  | "LARGE_SHARE"
  | "PASTED_ADDRESS"
  | "LATE_NIGHT";

export interface Signal {
  code: SignalCode;
  /** Plain-language sentence shown to the owner and the guardian. */
  text: string;
  /** Hard signals are enforced on-chain (the daily allowance), not just by the app. */
  hard?: boolean;
}

export interface Assessment {
  tier: Tier;
  signals: Signal[];
  remainingToday: number;
  overLimit: boolean;
  isNewAddress: boolean;
  /** Red always needs the guardian's signature. */
  needsGuardian: boolean;
  /** Yellow sends now and gives the guardian a heads-up. */
  notifyGuardian: boolean;
}
