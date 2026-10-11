/**
 * The cooling-off conversation: what Lumi asks, which answers count as warning signs,
 * and how answers combine into a known scam pattern. Shared by the agent (which reads
 * free-text answers with Claude) and the scripted fallback (which uses quick replies).
 */

export const FLAG_IDS = ["remote_guidance", "met_online", "never_met", "unlock_fee", "secrecy_urgency"] as const;
export type FlagId = (typeof FLAG_IDS)[number];

/** "unclear" means the owner hasn't said enough yet; Lumi may ask again in other words. */
export type FlagValue = "yes" | "no" | "unclear";
export type Flags = Record<FlagId, FlagValue>;

export type Pattern = "investment" | "impersonation" | "none" | "unclear";

export interface Question {
  id: FlagId;
  /** What Lumi asks. Short, warm, one idea per question. */
  q: string;
  /** Quick replies; index 1 is always the warning-sign answer. */
  quick: [string, string];
  /** Line for the guardian brief when the flag is "yes". */
  told: string;
}

export const QUESTIONS: Question[] = [
  {
    id: "remote_guidance",
    q: "Is anyone on the phone with you, or helping you with this right now?",
    quick: ["No, just me", "Yes, someone is guiding me"],
    told: "Someone is guiding him right now",
  },
  {
    id: "met_online",
    q: "How do you know the person you're sending this to?",
    quick: ["Family or an old friend", "We met online"],
    told: "Met the recipient online",
  },
  {
    id: "never_met",
    q: "Have you ever met them in person, or on a live video call?",
    quick: ["Yes", "Not yet"],
    told: "Has never met them in person or on video",
  },
  {
    id: "unlock_fee",
    q: "Is this money meant to unlock a withdrawal, like a tax, fee or deposit the platform asked for?",
    quick: ["No, it's for something else", "Yes, so I can get my money out"],
    told: 'Says this payment is a "tax" or fee to unlock a withdrawal',
  },
  {
    id: "secrecy_urgency",
    q: "Has anyone asked you to keep this private, or to hurry?",
    quick: ["No", "Yes, it has to be today"],
    told: "Was told to keep it private or to hurry",
  },
];

export const STORIES: Record<Exclude<Pattern, "unclear">, string> = {
  investment:
    "Here's a pattern that's been reported many times: a friendly contact online, a platform where small deposits grow on screen, then a tax or fee before the big withdrawal. Then another one.",
  impersonation:
    'Here\'s a pattern that\'s been reported many times: a caller says your account is at risk and guides you, step by step, to move money somewhere "safe". Real banks and companies never ask that.',
  none: "Your answers don't match the patterns I watch for. Since this needs a second look, your guardian still needs to confirm it.",
};

export function emptyFlags(): Flags {
  return { remote_guidance: "unclear", met_online: "unclear", never_met: "unclear", unlock_fee: "unclear", secrecy_urgency: "unclear" };
}

const RANK: Record<FlagValue, number> = { unclear: 0, no: 1, yes: 2 };

/**
 * Escalate-only merge. A "yes" can never be turned back into "no" or "unclear", whatever
 * the owner (or someone coaching them) types later, and whatever the model says.
 */
export function mergeFlags(prev: Flags, next: Partial<Record<string, unknown>>): Flags {
  const out = { ...prev };
  for (const id of FLAG_IDS) {
    const v = next[id];
    if (v !== "yes" && v !== "no" && v !== "unclear") continue;
    if (RANK[v] > RANK[out[id]]) out[id] = v;
  }
  return out;
}

export function yesCount(flags: Flags): number {
  return FLAG_IDS.filter((id) => flags[id] === "yes").length;
}

/** Deterministic pattern from the flags. The model may suggest a pattern, but this one is the floor. */
export function patternFromFlags(flags: Flags): Pattern {
  if (flags.remote_guidance === "yes") return "impersonation";
  if (flags.unlock_fee === "yes" || yesCount(flags) >= 2) return "investment";
  if (FLAG_IDS.every((id) => flags[id] !== "unclear")) return "none";
  return "unclear";
}

const PATTERN_RANK: Record<Pattern, number> = { unclear: 0, none: 1, investment: 2, impersonation: 3 };

/** Keep whichever pattern is more serious. Used to combine the model's view with the rule-based floor. */
export function worsePattern(a: Pattern, b: Pattern): Pattern {
  return PATTERN_RANK[a] >= PATTERN_RANK[b] ? a : b;
}

/** Next question to ask: the first flag still unclear, or null when the conversation is complete. */
export function nextQuestion(flags: Flags): Question | null {
  return QUESTIONS.find((q) => flags[q.id] === "unclear") ?? null;
}

/** Guardian-facing lines for every flag that came back "yes". */
export function toldLines(flags: Flags): string[] {
  return QUESTIONS.filter((q) => flags[q.id] === "yes").map((q) => q.told);
}

/**
 * Keyword reader for free-text answers when no model is available. Deliberately simple and
 * conservative: it only ever reports "yes" or "no" for the question being asked.
 */
export function readAnswerByKeywords(questionId: FlagId, text: string): FlagValue {
  const t = text.toLowerCase().trim();
  if (!t) return "unclear";
  const yesWords: Record<FlagId, RegExp> = {
    remote_guidance: /\b(yes|yeah|on the (phone|line)|guiding|helping me|told me|walking me|support (agent|team)|they're here)\b/,
    met_online: /\b(online|internet|whatsapp|telegram|instagram|facebook|dating|app|wechat|line|text(ed)? me|wrong number|linkedin)\b/,
    never_met: /\b(not yet|never|no,? (we )?haven't|only (chat|text|message)|soon)\b/,
    unlock_fee: /\b(tax|fee|deposit|unlock|withdraw|release|verification|clearance|get my money)\b/,
    secrecy_urgency: /\b(yes|today|now|hurry|quick|urgent|secret|private|don't tell|deadline|expire)\b/,
  };
  const noWords: Record<FlagId, RegExp> = {
    remote_guidance: /^(no|nope|just me|alone|nobody|no one)\b/,
    met_online: /\b(family|daughter|son|brother|sister|old friend|neighbou?r|colleague|school|church|in person)\b/,
    never_met: /^(yes|yeah|many times|of course|we have|in person)\b/,
    unlock_fee: /^(no|nope|it's for|rent|gift|bill|groceries)\b/,
    secrecy_urgency: /^(no|nope|not at all)\b/,
  };
  // A short, plain "no" ("Nope, no hurry") is taken at face value; anything longer is read for warning words first.
  const short = t.split(/\s+/).length <= 4;
  if (short && noWords[questionId].test(t)) return "no";
  if (yesWords[questionId].test(t)) return "yes";
  if (noWords[questionId].test(t)) return "no";
  return "unclear";
}
