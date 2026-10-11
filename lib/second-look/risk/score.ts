import type { Assessment, SignalCode } from "./types";
import { QUESTIONS, type FlagId, type Flags, type Pattern } from "./conversation";

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
};

/** Points per warning-sign answer. */
const FLAG_POINTS: Record<FlagId, { points: number; label: string }> = {
  remote_guidance: { points: 25, label: "Someone is guiding him right now" },
  unlock_fee: { points: 25, label: "Paying a fee to unlock a withdrawal" },
  secrecy_urgency: { points: 14, label: "Told to hurry or keep it quiet" },
  met_online: { points: 12, label: "Met the recipient online" },
  never_met: { points: 12, label: "Never met them in person or on video" },
};

const UNCLEAR_POINTS = 4;
const GROUP_CAP: Record<ScoreGroup, number> = { transfer: 30, recipient: 40, conversation: 60 };

export function bandFor(score: number): ScoreBand {
  return score >= 70 ? "high" : score >= 40 ? "elevated" : "low";
}

export function riskScore(
  assessment: Assessment,
  conversation?: { flags: Flags; attempts?: Partial<Record<FlagId, number>>; pattern: Pattern },
): RiskScore {
  const items: ScoreItem[] = [];
  for (const s of assessment.signals) {
    const p = SIGNAL_POINTS[s.code];
    if (p) items.push({ group: p.group, label: p.label, points: p.points });
  }
  if (conversation) {
    for (const q of QUESTIONS) {
      const v = conversation.flags[q.id];
      if (v === "yes") items.push({ group: "conversation", ...FLAG_POINTS[q.id] });
      else if (v === "unclear" && (conversation.attempts?.[q.id] ?? 0) >= 2)
        items.push({ group: "conversation", points: UNCLEAR_POINTS, label: "Didn't give a clear answer" });
    }
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
  else if (pattern === "impersonation" && score < 80) floor = { value: 80, reason: "Matches an impersonation pattern" };
  else if (pattern === "investment" && score < 75) floor = { value: 75, reason: "Matches an investment-scam pattern" };
  if (floor) score = floor.value;

  return { score, band: bandFor(score), groups, items, floor };
}
