import { DAY, HOUR } from "./assess";

/** Requests wait 24h for the guardian, then expire. Doing nothing never sends money. */
export const EXPIRY_MS = DAY;
/** Reminders to the guardian, in hours after the request was created. */
export const REMINDER_HOURS = [0, 4, 20] as const;

export type RequestStatus = "chat" | "pending" | "approved" | "rejected" | "cancelled" | "expired" | "sent";

export const OPEN_STATUSES: RequestStatus[] = ["chat", "pending"];

export function isOpen(status: RequestStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

export interface Timeline {
  expired: boolean;
  expiresInMs: number;
  /** How many of the three reminders are due by now. */
  remindersDue: number;
}

export function timeline(createdAt: number, now: number): Timeline {
  const elapsed = now - createdAt;
  return {
    expired: elapsed >= EXPIRY_MS,
    expiresInMs: Math.max(0, EXPIRY_MS - elapsed),
    remindersDue: REMINDER_HOURS.filter((h) => elapsed >= h * HOUR).length,
  };
}

export type RuleChange =
  | { kind: "limit"; from: number; to: number }
  | { kind: "allow"; addr: string; label: string }
  | { kind: "removeGuardian" }
  /** Turning protection on: the guardian's first signature enables the daily allowance on-chain. */
  | { kind: "enableProtection"; limit: number };

/**
 * Which rule changes need the guardian. Anything that loosens protection does;
 * tightening it (lowering the limit) takes effect right away.
 */
export function ruleChangeNeedsGuardian(change: RuleChange): boolean {
  if (change.kind === "limit") return change.to > change.from;
  return true;
}
