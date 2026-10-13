/**
 * The cooling-off conversation, purpose first.
 *
 * 1. Lumi asks what the payment is for (six plain answers). The answer picks a path.
 * 2. Two or three factual questions for that path. Every question has concrete answers
 *    plus "Not sure", and the owner can always type in his own words.
 * 3. If the answers match a known scam, one thing he can check himself.
 * 4. Four ways out: call the guardian, check first and come back, send to the guardian, cancel.
 *
 * Shared by the agent (which reads free text with Claude), the scripted fallback (keyword
 * reader below) and the UI (which renders the options). Everything here is deterministic.
 */
import type { Assessment } from "./types";

// ---------- what the payment is for ----------

export const PURPOSES = ["investing", "known_person", "bill", "safe_account", "helping", "other"] as const;
export type Purpose = (typeof PURPOSES)[number];

export const PURPOSE_QUESTION = "What's this payment for?";

export const PURPOSE_OPTIONS: { label: string; purpose: Purpose }[] = [
  { label: "Investing or trading", purpose: "investing" },
  { label: "Paying someone I know", purpose: "known_person" },
  { label: "A bill or a purchase", purpose: "bill" },
  { label: "Moving it somewhere safer", purpose: "safe_account" },
  { label: "Helping someone in trouble", purpose: "helping" },
  { label: "Something else", purpose: "other" },
];

/** Short label for the guardian brief ("What it's for"). */
export const PURPOSE_LABELS: Record<Purpose, string> = {
  investing: "Investing or trading",
  known_person: "Paying someone he knows",
  bill: "A bill or a purchase",
  safe_account: 'Moving money somewhere "safer"',
  helping: "Helping someone in trouble",
  other: "Something else",
};

// ---------- facts Lumi listens for ----------

/** Each fact is phrased so that "yes" is the warning sign. */
export const FACT_IDS = [
  "remote_guidance",
  "told_at_risk",
  "unlock_fee",
  "online_contact",
  "never_withdrawn",
  "directed_amount",
  "unverified",
  "addr_from_message",
  "secrecy_urgency",
] as const;
export type FactId = (typeof FACT_IDS)[number];

/** "unsure" is a fine answer (he tapped Not sure). "unclear" means he hasn't really answered yet. */
export type FactValue = "yes" | "no" | "unsure" | "unclear";
export type Facts = Record<FactId, FactValue>;

/** Line for the guardian brief when a fact is "yes". */
export const FACT_TOLD: Record<FactId, string> = {
  remote_guidance: "Someone is on the phone or guiding him right now",
  told_at_risk: "Someone told him his money is at risk",
  unlock_fee: 'Says this payment is a "tax" or fee to unlock a withdrawal',
  online_contact: "Heard about it from someone online, or an ad",
  never_withdrawn: "Hasn't been able to take money out of it",
  directed_amount: "Someone else chose the amount",
  unverified: "Hasn't checked on live video or a number he already had",
  addr_from_message: "Got the address in a message or from a website",
  secrecy_urgency: "Was told to hurry or keep it quiet",
};

// ---------- the questions ----------

export type QuestionId = "inv_source" | "inv_withdrawn" | "inv_amount" | "sa_who" | "remote" | "hurry" | "help_who" | "help_check" | "addr_source";

export interface AnswerOption {
  label: string;
  /** Facts this answer settles. The first key is the question's own fact. */
  sets: Partial<Facts>;
}

export interface Question {
  id: QuestionId;
  /** The fact this question settles. */
  fact: FactId;
  /** What Lumi asks. Short, warm, one idea, a fact rather than a judgement. */
  q: string;
  /** Concrete answers; "Not sure" is appended to every question. */
  options: AnswerOption[];
  /** Free-text reader for this question: first match wins. */
  read: [RegExp, FactValue][];
}

const NOT_SURE = "Not sure";
const opt = (label: string, sets: Partial<Facts>): AnswerOption => ({ label, sets });
const withNotSure = (q: Omit<Question, "options"> & { options: AnswerOption[] }): Question => ({
  ...q,
  options: [...q.options, opt(NOT_SURE, { [q.fact]: "unsure" })],
});

const LEADING_NO = /^(no|nope|nah|nobody|no one|not at all)\b/;
const LEADING_YES = /^(yes|yeah|yep|yup|sure|of course)\b/;

export const QUESTIONS: Record<QuestionId, Question> = {
  inv_source: withNotSure({
    id: "inv_source",
    fact: "online_contact",
    q: "How did you first hear about it?",
    options: [
      opt("From someone I know in person", { online_contact: "no" }),
      opt("From someone I met online or by message", { online_contact: "yes" }),
      opt("An ad or a post online", { online_contact: "yes" }),
    ],
    read: [
      [/\b(whatsapp|telegram|instagram|facebook|wechat|tiktok|discord|linkedin|dating|online|internet|wrong number|group chat|\bads?\b|advert|social media|youtube|post)\b/, "yes"],
      [/\b(friend|family|son|daughter|brother|sister|colleague|neighbou?r|in person|my bank|my advisor|church|school)\b/, "no"],
    ],
  }),
  inv_withdrawn: withNotSure({
    id: "inv_withdrawn",
    fact: "never_withdrawn",
    q: "Have you taken money out of it before?",
    options: [
      opt("Yes, back to my bank", { never_withdrawn: "no" }),
      opt("Not yet", { never_withdrawn: "yes" }),
      opt("I tried, but they want a fee first", { never_withdrawn: "yes", unlock_fee: "yes" }),
    ],
    read: [
      [/\b(tax|fee|deposit|unlock|clearance|verification)\b/, "yes"],
      [/^(no|nope|not yet|never)\b|\b(can'?t|cannot|couldn'?t|haven'?t|won'?t let me)\b/, "yes"],
      [/^(yes|yeah|yep)\b|\b(many times|i have|took (some )?out|withdrew|got (it|some|my money) back)\b/, "no"],
    ],
  }),
  inv_amount: withNotSure({
    id: "inv_amount",
    fact: "directed_amount",
    q: "Whose idea was this amount?",
    options: [
      opt("Mine", { directed_amount: "no" }),
      opt("Someone there suggested it", { directed_amount: "yes" }),
      opt("It's a tax or fee so I can withdraw", { directed_amount: "yes", unlock_fee: "yes" }),
    ],
    read: [
      [/\b(tax|fee|deposit|unlock)\b/, "yes"],
      [/\b(someone|they|he|she|manager|mentor|advisor|adviser|teacher|coach|told|suggested|asked)\b/, "yes"],
      [/^(me|mine|my (own )?idea|i (did|chose|decided|picked))\b|\bmy (own )?idea\b/, "no"],
    ],
  }),
  sa_who: withNotSure({
    id: "sa_who",
    fact: "told_at_risk",
    q: "Who told you your money was at risk?",
    options: [
      opt("No one, it's my own idea", { told_at_risk: "no" }),
      opt("A call or message from my bank", { told_at_risk: "yes" }),
      opt("The police, a company or an official", { told_at_risk: "yes" }),
    ],
    read: [
      [/^(no ?one|nobody|me|myself|my own|i decided)\b|\bmy own idea\b/, "no"],
      [/\b(bank|police|call(ed)?|message|text|email|government|official|fraud|security|company|amazon|apple|microsoft|irs|agent)\b/, "yes"],
    ],
  }),
  remote: withNotSure({
    id: "remote",
    fact: "remote_guidance",
    q: "Is anyone on the phone with you, or guiding you, right now?",
    options: [opt("No, just me", { remote_guidance: "no" }), opt("Yes, someone is guiding me", { remote_guidance: "yes" })],
    read: [
      [LEADING_NO, "no"],
      [/\b(just me|alone|by myself)\b/, "no"],
      [LEADING_YES, "yes"],
      [/\b(on the (phone|line|call)|guiding|walking me|helping me|telling me|screen ?shar|remote|anydesk|teamviewer|call with me)\b/, "yes"],
    ],
  }),
  hurry: withNotSure({
    id: "hurry",
    fact: "secrecy_urgency",
    q: "Did anyone ask you to hurry, or to keep this quiet?",
    options: [opt("No", { secrecy_urgency: "no" }), opt("Yes", { secrecy_urgency: "yes" })],
    read: [
      [LEADING_NO, "no"],
      [LEADING_YES, "yes"],
      [/\b(today|right now|now|immediately|hurry|quick(ly)?|urgent|deadline|expires?|secret|quiet|private|don'?t tell)\b/, "yes"],
    ],
  }),
  help_who: withNotSure({
    id: "help_who",
    fact: "online_contact",
    q: "Who are you helping?",
    options: [
      opt("My child or grandchild", { online_contact: "no" }),
      opt("A friend or relative", { online_contact: "no" }),
      opt("Someone I know online", { online_contact: "yes" }),
    ],
    read: [
      [/\b(online|internet|whatsapp|telegram|instagram|facebook|dating|met (him|her|them) (on|online))\b/, "yes"],
      [/\b(son|daughter|grand(son|daughter|child|kid)|child|kid|friend|relative|brother|sister|nephew|niece|cousin|mom|dad|mother|father|wife|husband)\b/, "no"],
    ],
  }),
  help_check: withNotSure({
    id: "help_check",
    fact: "unverified",
    q: "Have you spoken with them on live video, or called them back on a number you already had?",
    options: [opt("Yes, I checked it's really them", { unverified: "no" }), opt("Not yet", { unverified: "yes" })],
    read: [
      [/^(no|nope|not yet|never)\b|\b(haven'?t|couldn'?t|can'?t|new number|lost (his|her|their) phone)\b/, "yes"],
      [/^(yes|yeah|yep)\b|\b(video|called (him|her|them) back|spoke|checked|saw (him|her|them))\b/, "no"],
    ],
  }),
  addr_source: withNotSure({
    id: "addr_source",
    fact: "addr_from_message",
    q: "Where did this address come from?",
    options: [
      opt("From them in person, or a bill I trust", { addr_from_message: "no" }),
      opt("Someone sent it in a message or a call", { addr_from_message: "yes" }),
      opt("A website or app told me to use it", { addr_from_message: "yes" }),
    ],
    read: [
      [/\b(in person|invoice|bill|my (own|son|daughter)|face to face|they wrote it down)\b/, "no"],
      [/\b(message|text|chat|whatsapp|telegram|email|call|website|site|app|link|they (sent|gave))\b/, "yes"],
    ],
  }),
};

export type PathId = "investment" | "safe_account" | "helping" | "everyday";

export const PATHS: Record<PathId, QuestionId[]> = {
  investment: ["inv_source", "inv_withdrawn", "inv_amount"],
  safe_account: ["sa_who", "remote", "hurry"],
  helping: ["help_who", "help_check", "hurry"],
  everyday: ["remote", "addr_source", "hurry"],
};

export function pathFor(purpose: Purpose): PathId {
  if (purpose === "investing") return "investment";
  if (purpose === "safe_account") return "safe_account";
  if (purpose === "helping") return "helping";
  return "everyday";
}

// ---------- reading free text when no model is available ----------

/** Purpose from free text, or null. Order matters: the most specific scam purposes first. */
export function readPurposeByKeywords(text: string): Purpose | null {
  const t = text.toLowerCase();
  if (/\b(safe(r)? (account|place|wallet)|keep it safe|protect (it|my money)|at risk|hacked|frozen|compromised|secure (account|wallet))\b/.test(t)) return "safe_account";
  if (/\b(invest|investing|investment|trading|trade|platform|profit|returns?|portfolio|mining|staking|forex)\b/.test(t)) return "investing";
  if (/\b(trouble|emergency|hospital|bail|stuck|accident|lawyer|helping|help (him|her|them|my))\b/.test(t)) return "helping";
  if (/\b(bill|invoice|rent|purchase|buy(ing)?|shop(ping)?|order|tuition|repair)\b/.test(t)) return "bill";
  if (/\b(my (son|daughter|friend|sister|brother|wife|husband|family|mom|dad|grand\w+)|pay(ing)? (back|a friend)|gift|owe)\b/.test(t)) return "known_person";
  if (/\b(something else|other)\b/.test(t)) return "other";
  return null;
}

/**
 * Strong phrases that settle a fact whichever question is being asked ("No, but they say I need to
 * pay a 20% tax to withdraw" answers the phone question AND raises unlock_fee). Only ever "yes".
 */
const STRONG: Partial<Record<FactId, RegExp>> = {
  unlock_fee: /\b((tax|taxes|fee|fees|deposit|clearance|verification)\b.{0,40}\b(withdraw|withdrawal|take (it|my money|money) out|get my money|release|unlock)|(withdraw|withdrawal|unlock|release)\b.{0,30}\b(tax|fee|deposit))/,
  remote_guidance: /\b(on the (phone|line) with me|guiding me|walking me through|telling me what to (do|press|type|click)|screen ?shar\w*|remote access|anydesk|teamviewer|on (a )?(whatsapp |video )?call with me)\b/,
  told_at_risk: /\b(account (is|was) (hacked|compromised|frozen|at risk)|money (is )?(at risk|not safe)|(bank|police|fraud (team|department)|security team) (called|said|told|texted))\b/,
  online_contact: /\b(whatsapp|telegram|instagram|facebook|wechat|tiktok|dating (app|site)|wrong number|met (him|her|them) online)\b/,
  never_withdrawn: /\b(never (taken|withdrawn|took)|can'?t withdraw|haven'?t (taken|withdrawn)|not (able|allowed) to withdraw|won'?t let me withdraw)\b/,
  directed_amount: /\b((account manager|mentor|advisor|adviser|teacher|coach) (told|said|asked|suggested)|(told|asked) me (to )?(send|pay|deposit))\b/,
  unverified: /\b(new number|lost (his|her|their) phone|can'?t (talk|call)|no video)\b/,
  addr_from_message: /\b(sent (me )?(the |this )?address|address (in|by) (a |the )?(message|text|chat|email))\b/,
  secrecy_urgency: /\b((must|has to|have to|needs? to|told me to)\b.{0,30}\b(today|now|immediately|quickly|hurry)|don'?t tell|keep (it|this) (quiet|secret|private)|deadline|urgent)\b/,
};

const UNSURE = /^(not sure|unsure|i don'?t know|don'?t know|no idea|maybe|i'?m not sure)\b/;

const NEGATION = /\b(no one|nobody|not|never|isn'?t|aren'?t|wasn'?t|didn'?t|no)\b[^.,;!?]{0,20}$/;

/** A strong phrase that isn't negated just before it ("nobody is guiding me" doesn't count). */
function strongYes(id: FactId, t: string): boolean {
  const re = STRONG[id];
  if (!re) return false;
  const m = re.exec(t);
  if (!m) return false;
  // The never/can't facts carry their own negation inside the phrase.
  if (id === "never_withdrawn" || id === "unverified") return true;
  return !NEGATION.test(t.slice(0, m.index));
}

/** What the keyword reader takes from one free-text answer: the asked fact, plus any strong "yes" elsewhere. */
export function readAnswerByKeywords(questionId: QuestionId | null, text: string): Partial<Facts> {
  const t = text.toLowerCase().trim();
  const out: Partial<Facts> = {};
  if (!t) return out;
  const asked = questionId ? QUESTIONS[questionId].fact : null;
  for (const id of FACT_IDS) if (id !== asked && strongYes(id, t)) out[id] = "yes";
  if (!questionId) return out;
  const q = QUESTIONS[questionId];
  if (UNSURE.test(t)) {
    out[q.fact] = "unsure";
    return out;
  }
  for (const [re, v] of q.read) {
    if (re.test(t)) {
      out[q.fact] = v;
      break;
    }
  }
  if (!out[q.fact] && strongYes(q.fact, t)) out[q.fact] = "yes";
  // A tax or fee mentioned while answering an investment question is the fee step itself.
  if ((questionId === "inv_withdrawn" || questionId === "inv_amount") && /\b(tax|fee|deposit|unlock)\b/.test(t)) out.unlock_fee = "yes";
  return out;
}

// ---------- merging, escalate-only ----------

export function emptyFacts(): Facts {
  return Object.fromEntries(FACT_IDS.map((id) => [id, "unclear"])) as Facts;
}

const RANK: Record<FactValue, number> = { unclear: 0, unsure: 1, no: 2, yes: 3 };

/**
 * Escalate-only merge. A "yes" can never be turned back into "no", "unsure" or "unclear",
 * whatever the owner (or someone coaching him) types later, and whatever the model says.
 */
export function mergeFacts(prev: Facts, next: Partial<Record<string, unknown>>): Facts {
  const out = { ...prev };
  for (const id of FACT_IDS) {
    const v = next[id];
    if (v !== "yes" && v !== "no" && v !== "unsure" && v !== "unclear") continue;
    if (RANK[v] > RANK[out[id]]) out[id] = v;
  }
  return out;
}

export function yesCount(facts: Facts, among: readonly FactId[] = FACT_IDS): number {
  return among.filter((id) => facts[id] === "yes").length;
}

// ---------- which question next ----------

export const MAX_ATTEMPTS = 2;
export type Attempts = Partial<Record<QuestionId | "purpose", number>>;

/**
 * Next question still worth asking: "purpose" until it's chosen, then the first question on the
 * path whose fact is still unclear and that hasn't been asked twice already. Null when done.
 */
export function nextQuestion(c: { purpose: Purpose | null; facts: Facts; attempts: Attempts }): QuestionId | "purpose" | null {
  if (!c.purpose) return (c.attempts.purpose ?? 0) < MAX_ATTEMPTS ? "purpose" : nextOnPath("everyday", c);
  return nextOnPath(pathFor(c.purpose), c);
}

function nextOnPath(path: PathId, c: { facts: Facts; attempts: Attempts }): QuestionId | null {
  return PATHS[path].find((id) => c.facts[QUESTIONS[id].fact] === "unclear" && (c.attempts[id] ?? 0) < MAX_ATTEMPTS) ?? null;
}

/** The path actually used (a purpose never chosen falls back to the everyday questions). */
export function pathOf(purpose: Purpose | null): PathId {
  return purpose ? pathFor(purpose) : "everyday";
}

/** Questions on the path that were asked twice without a clear answer. */
export function skippedQuestions(c: { purpose: Purpose | null; facts: Facts; attempts: Attempts }): Question[] {
  return PATHS[pathOf(c.purpose)].map((id) => QUESTIONS[id]).filter((q) => c.facts[q.fact] === "unclear" && (c.attempts[q.id] ?? 0) >= MAX_ATTEMPTS);
}

// ---------- known scam patterns ----------

export type Pattern = "investment" | "safe_account" | "emergency" | "none" | "unclear";

export const PATTERN_NAMES: Record<Exclude<Pattern, "none" | "unclear">, string> = {
  investment: "investment scam",
  safe_account: '"safe account" scam',
  emergency: "emergency scam",
};

/** Deterministic pattern from the purpose and facts. The model may suggest a worse one, never a milder one. */
export function patternFrom(purpose: Purpose | null, facts: Facts): Pattern {
  const investmentSteps = yesCount(facts, ["online_contact", "never_withdrawn", "directed_amount"]);
  const investment = facts.unlock_fee === "yes" || (purpose === "investing" && investmentSteps >= 2);
  const safeAccount = facts.told_at_risk === "yes" || facts.remote_guidance === "yes";
  const emergency = purpose === "helping" && (facts.unverified === "yes" || facts.secrecy_urgency === "yes");
  // The purpose decides which story fits best when more than one matches.
  if (purpose === "investing" && investment) return "investment";
  if (purpose === "helping" && emergency && !safeAccount) return "emergency";
  if (safeAccount) return "safe_account";
  if (investment) return "investment";
  if (emergency) return "emergency";
  const settled = purpose !== null && PATHS[pathFor(purpose)].every((id) => facts[QUESTIONS[id].fact] !== "unclear");
  return settled ? "none" : "unclear";
}

const PATTERN_RANK: Record<Pattern, number> = { unclear: 0, none: 1, emergency: 2, investment: 3, safe_account: 4 };

/** Keep whichever pattern is more serious. Used to combine the model's view with the rule-based floor. */
export function worsePattern(a: Pattern, b: Pattern): Pattern {
  return PATTERN_RANK[a] >= PATTERN_RANK[b] ? a : b;
}

export interface PatternStep {
  label: string;
  seen: boolean;
}

/** The steps of each known scam, and which ones this transfer shows ("4 of 5 steps seen"). */
export function patternSteps(pattern: Pattern, purpose: Purpose | null, facts: Facts, a: Assessment): PatternStep[] {
  const sig = (code: string) => a.signals.some((s) => s.code === code);
  if (pattern === "investment")
    return [
      { label: "Met through someone online, or an ad", seen: facts.online_contact === "yes" },
      { label: "Small amounts first, now much more", seen: sig("SMALL_THEN_LARGE") || sig("ESCALATING") },
      { label: "Hasn't been able to take money out", seen: facts.never_withdrawn === "yes" },
      { label: "Someone else chose the amount", seen: facts.directed_amount === "yes" },
      { label: 'A "tax" or fee to unlock a withdrawal', seen: facts.unlock_fee === "yes" },
    ];
  if (pattern === "safe_account")
    return [
      { label: "Told his money is at risk", seen: facts.told_at_risk === "yes" || purpose === "safe_account" },
      { label: "Someone is guiding him live", seen: facts.remote_guidance === "yes" },
      { label: "Asked to hurry or keep it quiet", seen: facts.secrecy_urgency === "yes" },
      { label: 'Money goes to a new "safe" address', seen: a.isNewAddress },
    ];
  if (pattern === "emergency")
    return [
      { label: "Someone close suddenly needs money", seen: purpose === "helping" },
      { label: "Hasn't checked it's really them", seen: facts.unverified === "yes" },
      { label: "Asked to hurry or keep it quiet", seen: facts.secrecy_urgency === "yes" },
      { label: "Money goes to a new address", seen: a.isNewAddress },
    ];
  return [];
}

/** Lumi's short story once the questions are done. */
export const STORIES: Record<Exclude<Pattern, "unclear">, string> = {
  investment:
    "Here's a pattern that's been reported many times: a friendly contact online, a platform where small deposits grow on screen, then a tax or fee before the big withdrawal. Then another one.",
  safe_account:
    'Here\'s a pattern that\'s been reported many times: someone says your money is at risk and guides you, step by step, to move it somewhere "safe". Real banks and the police never ask that.',
  emergency:
    "Here's a pattern that's been reported many times: a message or call says someone you love is in trouble and needs money right away, and asks you not to tell anyone.",
  none: "Your answers don't match the patterns I watch for. Since this is above your usual, your guardian still confirms it.",
};

/** One thing to check yourself, when the answers match a pattern. */
export const SELF_CHECKS: Record<Exclude<Pattern, "none" | "unclear">, string> = {
  investment: "Try taking out 10 USDC first. A real platform lets you withdraw without paying anything first.",
  safe_account: "Hang up, and call the number on the back of your bank card yourself. Your real bank will never ask you to move money to keep it safe.",
  emergency: "Call them back on the number you've always had for them, or ask something only they would know.",
};

/** Guardian-facing lines for every fact that came back "yes", and every "Not sure". */
export function toldLines(facts: Facts): string[] {
  const yes = FACT_IDS.filter((id) => facts[id] === "yes").map((id) => FACT_TOLD[id]);
  return yes;
}

export function unsureLines(purpose: Purpose | null, facts: Facts): string[] {
  return PATHS[pathOf(purpose)]
    .map((id) => QUESTIONS[id])
    .filter((q) => facts[q.fact] === "unsure")
    .map((q) => `Wasn't sure: "${q.q}"`);
}
