import {
  FACT_IDS,
  PATHS,
  PATTERN_NAMES,
  PURPOSE_LABELS,
  PURPOSE_OPTIONS,
  PURPOSE_QUESTION,
  QUESTIONS,
  SELF_CHECKS,
  STORIES,
  emptyFacts,
  mergeFacts,
  nextQuestion,
  openingReason,
  pathOf,
  patternFrom,
  patternSteps,
  readAnswerByKeywords,
  readPurposeByKeywords,
  riskScore,
  skippedQuestions,
  toldLines,
  unsureLines,
  worsePattern,
  type FactId,
  type Facts,
  type Pattern,
  type Purpose,
  type QuestionId,
} from "../risk";
import { fmtAmount, symOf } from "../assets";
import { LIMITS, cleanOwnerInput, safeText } from "./guardrails";
import type { StructuredModel } from "./model";
import { BRIEF_SYSTEM, TURN_SYSTEM } from "./prompts";
import { BriefOutput, TurnOutput } from "./schemas";
import type { ChatLine, Conversation, GuardianBrief, TransferRequest } from "./types";

export interface Names {
  owner: string;
  guardian: string;
}

export interface TurnInput {
  text?: string;
  /** Index of a tapped answer for the question being asked ("Not sure" is the last one). */
  option?: number;
}

/** Answer labels Dad can tap, for the guardian brief's "in his words" (tapped answers are shown as facts instead). */
const TAPPABLE = new Set([...PURPOSE_OPTIONS.map((o) => o.label), ...Object.values(QUESTIONS).flatMap((q) => q.options.map((o) => o.label))].map((t) => t.toLowerCase()));

/**
 * Lumi, the conversational half of Second Look.
 *
 * What Lumi decides on its own: how to phrase the conversation, which warning signs the
 * owner's free-text answers contain, and how to summarise them for the guardian.
 * What Lumi can never do: lower the risk tier, remove a warning sign, change the purpose once
 * chosen, approve, sign or send. Those are enforced by the rule engine, the 2-of-2 Safe and
 * the guardian's Ledger.
 */
export class Lumi {
  constructor(
    private model: StructuredModel | null,
    private names: Names,
    private now: () => number = Date.now,
  ) {}

  get usingAI(): boolean {
    return this.model !== null;
  }

  open(req: Pick<TransferRequest, "assessment">): Conversation {
    const facts = emptyFacts();
    const ts = this.now();
    const base = { purpose: null, facts, pattern: "unclear" as Pattern, ownerWantsToStop: false, attempts: {}, source: "script" as const };
    const initial = riskScore(req.assessment, { ...base }).score;
    if (req.assessment.lightPath)
      return {
        ...base,
        scoreTrail: [initial],
        lines: [{ from: "lumi", ts, text: `This is above your daily limit, so ${this.names.guardian} confirms. No questions needed.` }],
        asking: null,
        done: true,
        light: true,
      };
    return {
      ...base,
      scoreTrail: [initial],
      lines: [
        {
          from: "lumi",
          ts,
          text: `Before this goes out, can we take two minutes together? It's ${openingReason(req.assessment)}. That's often completely fine. A short summary of our chat goes to ${this.names.guardian}, and no one else.`,
        },
        { from: "lumi", ts, text: PURPOSE_QUESTION },
      ],
      asking: "purpose",
      done: false,
    };
  }

  async turn(req: TransferRequest, input: TurnInput): Promise<Conversation> {
    const c = req.conversation;
    if (c.done) return c;
    const asking = c.asking;
    const askedFact: FactId | null = asking && asking !== "purpose" ? QUESTIONS[asking].fact : null;

    // A tapped answer is unambiguous and read by code, instantly.
    let tappedPurpose: Purpose | undefined;
    let tappedFacts: Partial<Facts> | undefined;
    let tappedLabel: string | undefined;
    if (input.option !== undefined && input.text === undefined) {
      if (asking === "purpose") {
        const o = PURPOSE_OPTIONS[input.option];
        if (!o) throw new Error("Empty answer");
        tappedPurpose = o.purpose;
        tappedLabel = o.label;
      } else if (asking) {
        const o = QUESTIONS[asking].options[input.option];
        if (!o) throw new Error("Empty answer");
        tappedFacts = o.sets;
        tappedLabel = o.label;
      }
    }
    const text = cleanOwnerInput(input.text ?? tappedLabel);
    if (!text) throw new Error("Empty answer");
    const lines: ChatLine[] = [...c.lines, { from: "owner", text, ts: this.now() }];

    let purpose = c.purpose;
    let facts = c.facts;
    let ack: string;
    let modelQuestion: { asking: string; question: string } | null = null;
    let modelPattern: Pattern = "unclear";
    let wantsToStop = c.ownerWantsToStop || /\b(cancel|stop|never ?mind|don'?t send)\b/i.test(text);
    let source: Conversation["source"] = this.model ? "ai" : "script";

    if (tappedPurpose || tappedFacts) {
      if (tappedPurpose && !purpose) purpose = tappedPurpose;
      if (tappedFacts) facts = mergeFacts(facts, tappedFacts);
      const v = askedFact ? facts[askedFact] : null;
      ack = tappedPurpose ? "Thanks, that helps." : Object.values(tappedFacts ?? {}).includes("yes") ? "Thank you for telling me." : v === "unsure" ? "That's okay. Not sure is a fine answer." : "Okay, thank you.";
    } else {
      const before = facts;
      const ai = this.model ? await this.readWithModel(req, lines, purpose, facts, asking).catch(() => null) : null;
      if (ai) {
        // The model may choose the purpose only while it's being asked, and never change it afterwards.
        if (!purpose && asking === "purpose" && ai.purpose !== "unclear") purpose = ai.purpose;
        // The model may raise any warning sign, but may only clear the question actually being asked.
        // That way a coached or injected message can't skip the rest of the conversation.
        const fromModel: Partial<Facts> = {};
        for (const id of FACT_IDS) {
          const v = ai.facts[id];
          fromModel[id] = (v === "no" || v === "unsure") && id !== askedFact ? "unclear" : v;
        }
        facts = mergeFacts(facts, fromModel);
        modelPattern = ai.pattern;
        wantsToStop = wantsToStop || ai.owner_wants_to_stop;
        ack = safeText(ai.ack, LIMITS.ack, "Thank you for telling me.").text;
        modelQuestion = { asking: ai.asking, question: ai.question };
        source = "ai";
      } else {
        source = "script";
        if (asking === "purpose" && !purpose) purpose = readPurposeByKeywords(text);
        facts = mergeFacts(facts, readAnswerByKeywords(asking === "purpose" ? null : asking, text));
        const newYes = FACT_IDS.some((id) => facts[id] === "yes" && before[id] !== "yes");
        const v = askedFact ? facts[askedFact] : null;
        ack = newYes
          ? "Thank you for telling me."
          : asking === "purpose"
            ? purpose
              ? "Thanks, that helps."
              : "Sorry, I'm not sure I understood. Could you tap the closest one?"
            : v === "unsure"
              ? "That's okay. Not sure is a fine answer."
              : v === "no" || v === "yes"
                ? "Okay, thank you."
                : "Sorry, I'm not sure I understood.";
      }
    }

    // Count an attempt if the question just asked is still unanswered.
    const attempts = { ...c.attempts };
    if (asking === "purpose" && !purpose) attempts.purpose = (attempts.purpose ?? 0) + 1;
    else if (askedFact && asking && asking !== "purpose" && facts[askedFact] === "unclear") attempts[asking] = (attempts[asking] ?? 0) + 1;

    // The model may escalate the pattern, never soften it below what the answers show.
    const floor = patternFrom(purpose, facts);
    const pattern = modelPattern === "investment" || modelPattern === "safe_account" || modelPattern === "emergency" ? worsePattern(floor, modelPattern) : floor;

    const next = nextQuestion({ purpose, facts, attempts });
    const out: ChatLine[] = [];
    const ts = this.now();
    let selfCheck: string | undefined;
    if (next) {
      const fallback = next === "purpose" ? PURPOSE_QUESTION : QUESTIONS[next].q;
      const own = modelQuestion && modelQuestion.asking === next ? safeText(modelQuestion.question, LIMITS.question, fallback).text : fallback;
      out.push({ from: "lumi", ts, text: `${ack} ${own}` });
    } else {
      const story = STORIES[pattern === "unclear" ? "none" : pattern].replace("your guardian", this.names.guardian);
      out.push({ from: "lumi", ts, text: `${ack} Thanks for being honest with me. ${story}` });
      // The self-check is shown as its own card under the chat, so it isn't repeated as a bubble.
      if (pattern === "investment" || pattern === "safe_account" || pattern === "emergency") selfCheck = SELF_CHECKS[pattern];
      out.push({ from: "lumi", ts, text: selfCheck ? "Before you decide, there's one thing you can check yourself, just below. What would you like to do? Nothing moves until you choose." : "What would you like to do? Nothing moves until you choose." });
    }

    const score = riskScore(req.assessment, { purpose, facts, attempts, pattern }).score;
    return {
      ...c,
      scoreTrail: [...(c.scoreTrail ?? []), score],
      lines: [...lines, ...out],
      purpose,
      facts,
      pattern,
      asking: next,
      done: next === null,
      ownerWantsToStop: wantsToStop,
      attempts,
      source,
      selfCheck,
    };
  }

  private async readWithModel(req: TransferRequest, lines: Conversation["lines"], purpose: Purpose | null, facts: Facts, asking: Conversation["asking"]): Promise<TurnOutput> {
    const path = purpose ? PATHS[pathOf(purpose)].map((id) => `${id}: "${QUESTIONS[id].q}"`).join("\n") : "(not chosen yet)";
    const user = [
      `Owner: ${this.names.owner}. Guardian: ${this.names.guardian}.`,
      `Transfer: ${fmtAmount(req.amount, symOf(req))} to "${req.label}"${req.assessment.isNewAddress ? " (a new address)" : ""}.`,
      `Why it was flagged:\n${req.assessment.signals.map((s) => `- ${s.text}`).join("\n")}`,
      `Purpose: ${purpose ?? "not chosen yet"}${purpose ? " (fixed; repeat it)" : ""}.`,
      `Questions on this path, in order (skip any whose fact is already settled):\n${path}`,
      `The question just asked: ${asking === "purpose" ? `purpose ("${PURPOSE_QUESTION}")` : asking ? `${asking} ("${QUESTIONS[asking].q}", fact ${QUESTIONS[asking].fact})` : "none"}.`,
      `Facts settled so far (you may not change a "yes"): ${JSON.stringify(facts)}`,
      `Conversation so far:\n${lines.map((l) => (l.from === "owner" ? `<owner_message>${l.text}</owner_message>` : `Lumi: ${l.text}`)).join("\n")}`,
    ].join("\n\n");
    return this.model!.generate({ system: TURN_SYSTEM, user, schema: TurnOutput, maxTokens: 700 });
  }

  async brief(req: TransferRequest): Promise<GuardianBrief> {
    const c = req.conversation;
    const key = c.lines.length + (c.checkingFirst ? 1000 : 0) + (c.callRequested ? 2000 : 0);
    if (req.brief && req.brief.basedOn === key) return req.brief;

    const score = riskScore(req.assessment, c);
    const floorHigh = score.band === "high";
    const told = c.light ? [`Lumi didn't ask questions: a trusted contact, only above the daily limit`] : [...toldLines(c.facts), ...unsureLines(c.purpose, c.facts)];
    for (const q of skippedQuestions(c)) told.push(`Didn't give a clear answer to: "${q.q}"`);
    if (!c.done) told.push(`Lumi is still talking with ${this.names.owner}…`);
    else if (!told.length) told.push("Nothing unusual in the answers");

    const scam = c.pattern === "investment" || c.pattern === "safe_account" || c.pattern === "emergency" ? c.pattern : null;
    const base = {
      score,
      scoreTrail: c.scoreTrail ?? [],
      whyFlagged: req.assessment.signals.map((s) => s.text),
      told,
      purpose: c.purpose ? PURPOSE_LABELS[c.purpose] : null,
      matches: scam ? { name: PATTERN_NAMES[scam], steps: patternSteps(scam, c.purpose, c.facts, req.assessment) } : null,
      selfCheck: c.selfCheck,
      light: !!c.light,
      checkingFirst: c.checkingFirst,
      callRequested: c.callRequested,
      basedOn: key,
    };
    const template = this.templateBrief(req, floorHigh);

    if (!this.model || c.light) return { ...base, ...template, source: "script" };
    try {
      const out = await this.model.generate({ system: BRIEF_SYSTEM, user: this.briefInput(req, told, base.matches), schema: BriefOutput, maxTokens: 700 });
      // The level follows the deterministic score, so the pill and the gauge always agree.
      // The model's own risk guess is ignored; it raises the score only through warning signs.
      const risk = floorHigh ? "high" : "elevated";
      return {
        ...base,
        risk,
        headline: safeText(out.headline, LIMITS.headline, template.headline).text,
        inTheirWords: out.in_their_words
          .slice(0, 4)
          .map((l) => safeText(l, LIMITS.line, ""))
          .filter((r) => !r.replaced)
          .map((r) => r.text),
        ourRead: safeText(out.our_read, LIMITS.read, template.ourRead).text,
        suggestedAction: risk === "high" ? "call_first" : out.suggested_action,
        source: "ai",
      };
    } catch {
      return { ...base, ...template, source: "script" };
    }
  }

  private templateBrief(req: TransferRequest, high: boolean) {
    const { owner } = this.names;
    const c = req.conversation;
    const read = c.light
      ? `${owner} is sending to a trusted contact. It's only above his daily limit, with no scam signal, so Lumi didn't ask questions.`
      : c.pattern === "investment"
        ? `This matches a common investment scam: an online contact, a platform where money seems to grow, then a fee to withdraw. We suggest calling ${owner} before you decide.`
        : c.pattern === "safe_account"
          ? `This matches a common "safe account" scam: someone posing as a bank or an official says ${owner}'s money is at risk and guides him to move it. We suggest calling ${owner} before you decide.`
          : c.pattern === "emergency"
            ? `This matches a common emergency scam: someone close supposedly needs money right away, and ${owner} hasn't checked it's really them. We suggest calling ${owner} before you decide.`
            : high
              ? `The transfer itself matches a known scam pattern, even though the answers don't. We suggest calling ${owner} before you decide.`
              : `This is unusual for ${owner}, but the answers don't match a known scam pattern. A quick call is still a good idea.`;
    return {
      risk: high ? ("high" as const) : ("elevated" as const),
      headline: `${owner} wants to send ${fmtAmount(req.amount, symOf(req))} to ${req.label}`,
      // Only what he typed himself; tapped answers are already in the "told" lines.
      inTheirWords: c.lines
        .filter((l) => l.from === "owner" && !TAPPABLE.has(l.text.toLowerCase()))
        .slice(-3)
        .map((l) => `"${l.text}"`),
      ourRead: read,
      suggestedAction: high ? ("call_first" as const) : ("call_if_unsure" as const),
    };
  }

  private briefInput(req: TransferRequest, told: string[], matches: GuardianBrief["matches"]): string {
    const c = req.conversation;
    return [
      `Owner: ${this.names.owner}. Guardian: ${this.names.guardian}.`,
      `Transfer: ${fmtAmount(req.amount, symOf(req))} to "${req.label}"${req.assessment.isNewAddress ? " (a new address)" : ""}.`,
      `Rule-based signals:\n${req.assessment.signals.map((s) => `- [${s.code}] ${s.text}`).join("\n")}`,
      `What it's for: ${c.purpose ? PURPOSE_LABELS[c.purpose] : "not said"}.`,
      `Settled facts: ${JSON.stringify(c.facts)}. Pattern so far: ${c.pattern}.`,
      matches ? `Known scam steps seen (${matches.name}): ${matches.steps.map((s) => `${s.seen ? "[x]" : "[ ]"} ${s.label}`).join("; ")}` : "No known scam pattern matched.",
      `Lines already shown to the guardian:\n${told.map((t) => `- ${t}`).join("\n")}`,
      `Transcript:\n${c.lines.map((l) => (l.from === "owner" ? `<owner_message>${l.text}</owner_message>` : `Lumi: ${l.text}`)).join("\n")}`,
    ].join("\n\n");
  }
}

export type { FactId, QuestionId };
