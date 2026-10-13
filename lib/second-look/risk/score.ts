import type { Assessment, SignalCode } from "./types";
import { FACT_IDS, skippedQuestions, type Attempts, type FactId, type Facts, type Pattern, type Purpose } from "./conversation";

/**
 * The guardian's risk score, 0–100. Deterministic: computed from the rule-based signals
 * and the settled answers, never written by the model. The model can only move it up
 * indirectly, by spotting a warning sign in Dad's words; it can't set or lower the number.
 *
 * The score explains; it doesn't decide. Whether the guardian must sign is still the tier
 * (and the on-chain allowance).
 */

export type ScoreBand = "low" | "elevated" | "high";
export type ScoreGroup = "transfer" | "recipient" | "conversation";

export interface ScoreItem {
  group: ScoreGroup;
  label: string;
  points: number;
}

export interface RiskScore {
  score: number;
  band: ScoreBand;
  /** Points per group, after the cap, for the breakdown bars. */
  groups: Record<ScoreGroup, number>;
  /** Every reason that added points, biggest first. */
  items: ScoreItem[];
  /** Set when a known pattern or a reported address lifted the score to a floor. */
  floor?: { value: number; reason: string };
}

export const GROUP_LABELS: Record<ScoreGroup, string> = {
  transfer: "The transfer",
  recipient: "The recipient",
  conversation: "What he told Lumi",
};

/** Points per rule-based signal, and which bar it belongs to. */
const SIGNAL_POINTS: Record<SignalCode, { group: ScoreGroup; points: number; label: string }> = {
  OVER_LIMIT: { group: "transfer", points: 10, label: "Above today's limit" },
  LARGE_VS_USUAL: { group: "transfer", points: 12, label: "Much larger than usual" },
  LARGE_SHARE: { group: "transfer", points: 10, label: "Large share of his balance" },
  LATE_NIGHT: { group: "transfer", points: 4, label: "Late at night" },
  BURST_TO_NEW: { group: "transfer", points: 14, label: "Several transfers to it today" },
  NEW_ADDRESS: { group: "recipient", points: 6, label: "Never sent here before" },
  PASTED_ADDRESS: { group: "recipient", points: 4, label: "Address was pasted in" },
  FRESH_ADDRESS: { group: "recipient", points: 10, label: "Address is only days old" },
  SMALL_THEN_LARGE: { group: "recipient", points: 18, label: "Small first, now much larger" },
  FLAGGED_ADDRESS: { group: "recipient", points: 40, label: "On a reported-scam list" },
  ESCALATING: { group: "recipient", points: 14, label: "Each transfer here bigger than the last" },
  DORMANT_THEN_LARGE: { group: "transfer", points: 8, label: "Weeks of quiet, then a large transfer" },
  AMOUNT_EDITS: { group: "transfer", points: 6, label: "Changed the amount several times" },
  LONG_PAUSE: { group: "transfer", points: 6, label: "Long pause on the send screen" },
};

/** Points per warning-sign answer. */
const FACT_POINTS: Record<FactId, { points: number; label: string }> = {
  remote_guidance: { points: 25, label: "Someone is guiding him right now" },
  unlock_fee: { points: 25, label: "Paying a fee to unlock a withdrawal" },
  told_at_risk: { points: 20, label: "Told his money is at risk" },
  secrecy_urgency: { points: 14, label: "Told to hurry or keep it quiet" },
  unverified: { points: 14, label: "Hasn't checked it's really them" },
  online_contact: { points: 12, label: "Heard about it from someone online" },
  directed_amount: { points: 12, label: "Someone else chose the amount" },
  never_withdrawn: { points: 10, label: "Hasn't taken money out before" },
  addr_from_message: { points: 10, label: "Address came in a message" },
};

/** A payment to move money somewhere "safe" is itself unusual: real banks never ask for it. */
const PURPOSE_POINTS: Partial<Record<Purpose, { points: number; label: string }>> = {
  safe_account: { points: 10, label: 'Moving money somewhere "safe"' },
};

const UNSURE_POINTS = 3;
const UNCLEAR_POINTS = 4;
const GROUP_CAP: Record<ScoreGroup, number> = { transfer: 30, recipient: 40, conversation: 60 };

export function bandFor(score: number): ScoreBand {
  return score >= 70 ? "high" : score >= 40 ? "elevated" : "low";
}

export function riskScore(
  assessment: Assessment,
  conversation?: { purpose: Purpose | null; facts: Facts; attempts?: Attempts; pattern: Pattern },
): RiskScore {
  const items: ScoreItem[] = [];
  for (const s of assessment.signals) {
    const p = SIGNAL_POINTS[s.code];
    if (p) items.push({ group: p.group, label: p.label, points: p.points });
  }
  if (conversation) {
    const p = conversation.purpose ? PURPOSE_POINTS[conversation.purpose] : undefined;
    if (p) items.push({ group: "conversation", ...p });
    for (const id of FACT_IDS) {
      const v = conversation.facts[id];
      if (v === "yes") items.push({ group: "conversation", ...FACT_POINTS[id] });
      else if (v === "unsure") items.push({ group: "conversation", points: UNSURE_POINTS, label: "Wasn't sure" });
    }
    const skipped = skippedQuestions({ purpose: conversation.purpose, facts: conversation.facts, attempts: conversation.attempts ?? {} });
    if (skipped.length) items.push({ group: "conversation", points: UNCLEAR_POINTS * skipped.length, label: "Didn't give a clear answer" });
  }
  items.sort((a, b) => b.points - a.points);

  const groups: Record<ScoreGroup, number> = { transfer: 0, recipient: 0, conversation: 0 };
  for (const it of items) groups[it.group] += it.points;
  for (const g of Object.keys(groups) as ScoreGroup[]) groups[g] = Math.min(groups[g], GROUP_CAP[g]);

  // Never 100: it is a guide for the guardian, not a verdict.
  let score = Math.min(99, groups.transfer + groups.recipient + groups.conversation);
  let floor: RiskScore["floor"];
  const pattern = conversation?.pattern;
  if (assessment.signals.some((s) => s.code === "FLAGGED_ADDRESS") && score < 85) floor = { value: 85, reason: "Reported-scam address" };
  else if (pattern === "safe_account" && score < 80) floor = { value: 80, reason: 'Matches a "safe account" scam' };
  else if (pattern === "investment" && score < 75) floor = { value: 75, reason: "Matches an investment-scam pattern" };
  else if (pattern === "emergency" && score < 70) floor = { value: 70, reason: "Matches an emergency scam" };
  if (floor) score = floor.value;

  return { score, band: bandFor(score), groups, items, floor };
}
