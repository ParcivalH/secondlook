import {
  QUESTIONS,
  STORIES,
  emptyFlags,
  mergeFlags,
  openingReason,
  patternFromFlags,
  readAnswerByKeywords,
  riskScore,
  toldLines,
  worsePattern,
  type FlagId,
  type Flags,
  type Pattern,
  type Question,
} from "../risk";
import { LIMITS, cleanOwnerInput, safeText } from "./guardrails";
import type { StructuredModel } from "./model";
import { BRIEF_SYSTEM, TURN_SYSTEM } from "./prompts";
import { BriefOutput, TurnOutput } from "./schemas";
import type { Conversation, GuardianBrief, TransferRequest } from "./types";

const MAX_ATTEMPTS = 2;
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export interface Names {
  owner: string;
  guardian: string;
}

export interface TurnInput {
  text?: string;
  /** Index of a quick reply (1 is always the warning-sign answer). */
  quick?: 0 | 1;
}

/** Next question still worth asking: unclear, and not already asked twice without a clear answer. */
export function pendingQuestion(c: Pick<Conversation, "flags" | "attempts">): Question | null {
  return QUESTIONS.find((q) => c.flags[q.id] === "unclear" && (c.attempts[q.id] ?? 0) < MAX_ATTEMPTS) ?? null;
}

/**
 * Lumi, the conversational half of Second Look.
 *
 * What Lumi decides on its own: how to phrase the conversation, which warning signs the
 * owner's free-text answers contain, and how to summarise them for the guardian.
 * What Lumi can never do: lower the risk tier, remove a warning sign, approve, sign or send.
 * Those are enforced by the rule engine, the 2-of-2 Safe and the guardian's Ledger.
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
    const flags = emptyFlags();
    const first = QUESTIONS[0]!;
    const ts = this.now();
    const initial = riskScore(req.assessment, { flags, pattern: "unclear" }).score;
    return {
      scoreTrail: [initial],
      lines: [
        {
          from: "lumi",
          ts,
          text: `Before this goes out, can we take two minutes together? It's ${openingReason(req.assessment)}. That's often completely fine. A short summary of our chat goes to ${this.names.guardian}, and no one else.`,
        },
        { from: "lumi", ts, text: first.q },
      ],
      flags,
      pattern: "unclear",
      done: false,
      ownerWantsToStop: false,
      attempts: { [first.id]: 0 },
      source: "script",
    };
  }

  async turn(req: TransferRequest, input: TurnInput): Promise<Conversation> {
    const c = req.conversation;
    if (c.done) return c;
    const current = pendingQuestion(c);
    const quickText = current && input.quick !== undefined ? current.quick[input.quick] : undefined;
    const text = cleanOwnerInput(input.text ?? quickText);
    if (!text) throw new Error("Empty answer");

    const lines = [...c.lines, { from: "owner" as const, text, ts: this.now() }];
    // A tapped quick reply is unambiguous; it sets a floor before the model reads anything.
    let flags: Flags = c.flags;
    if (current && input.quick !== undefined) flags = mergeFlags(flags, { [current.id]: input.quick === 1 ? "yes" : "no" });

    let ack: string;
    let modelQuestion: { asking: string; question: string } | null = null;
    let modelPattern: Pattern = "unclear";
    let wantsToStop = c.ownerWantsToStop;
    let source: Conversation["source"] = "script";

    const ai = this.model ? await this.readWithModel(req, lines, flags).catch(() => null) : null;
    if (ai) {
      // The model may raise any warning sign, but may only clear the question actually being asked.
      // That way a coached or injected message can't skip the rest of the conversation.
      const fromModel: Partial<Flags> = {};
      for (const [id, v] of Object.entries(ai.flags) as [FlagId, Flags[FlagId]][]) fromModel[id] = v === "no" && id !== current?.id ? "unclear" : v;
      flags = mergeFlags(flags, fromModel);
      modelPattern = ai.pattern;
      wantsToStop = wantsToStop || ai.owner_wants_to_stop;
      ack = safeText(ai.ack, LIMITS.ack, "Thank you for telling me.").text;
      modelQuestion = { asking: ai.asking, question: ai.question };
      source = "ai";
    } else {
      const value = current ? readAnswerByKeywords(current.id, text) : "unclear";
      if (current) flags = mergeFlags(flags, { [current.id]: value });
      wantsToStop = wantsToStop || /\b(cancel|stop|never ?mind|don'?t send)\b/i.test(text);
      ack = value === "yes" ? "Thank you for telling me." : value === "no" ? "Okay, thank you." : "Sorry, I'm not sure I understood.";
    }

    // Count an attempt if the question just asked is still unclear.
    const attempts = { ...c.attempts };
    if (current && flags[current.id] === "unclear") attempts[current.id] = (attempts[current.id] ?? 0) + 1;

    // The model may escalate the pattern, never soften it below what the answers show.
    const floor = patternFromFlags(flags);
    const pattern = modelPattern === "investment" || modelPattern === "impersonation" ? worsePattern(floor, modelPattern) : floor;

    const next = pendingQuestion({ flags, attempts });
    let reply: string;
    if (next) {
      const own = modelQuestion && modelQuestion.asking === next.id ? safeText(modelQuestion.question, LIMITS.question, next.q).text : next.q;
      reply = `${ack} ${own}`;
    } else {
      const story = STORIES[pattern === "unclear" ? "none" : pattern].replace("your guardian", this.names.guardian);
      reply = `${ack} Thanks for being honest with me. ${story} Would you like to call ${this.names.guardian} before deciding?`;
    }

    const score = riskScore(req.assessment, { flags, attempts, pattern }).score;
    return {
      scoreTrail: [...(c.scoreTrail ?? []), score],
      lines: [...lines, { from: "lumi", text: reply, ts: this.now() }],
      flags,
      pattern,
      done: next === null,
      ownerWantsToStop: wantsToStop,
      attempts,
      source,
    };
  }

  private async readWithModel(req: TransferRequest, lines: Conversation["lines"], flags: Flags): Promise<TurnOutput> {
    const user = [
      `Owner: ${this.names.owner}. Guardian: ${this.names.guardian}.`,
      `Transfer: ${money(req.amount)} USDC to "${req.label}"${req.assessment.isNewAddress ? " (a new address)" : ""}.`,
      `Why it was flagged:\n${req.assessment.signals.map((s) => `- ${s.text}`).join("\n")}`,
      `Facts settled so far (you may not change a "yes"): ${JSON.stringify(flags)}`,
      `Conversation so far:\n${lines
        .map((l) => (l.from === "owner" ? `<owner_message>${l.text}</owner_message>` : `Lumi: ${l.text}`))
        .join("\n")}`,
    ].join("\n\n");
    return this.model!.generate({ system: TURN_SYSTEM, user, schema: TurnOutput, maxTokens: 600 });
  }

  async brief(req: TransferRequest): Promise<GuardianBrief> {
    const c = req.conversation;
    if (req.brief && req.brief.basedOn === c.lines.length) return req.brief;

    const score = riskScore(req.assessment, c);
    const floorHigh = score.band === "high";
    const told = toldLines(c.flags);
    const skipped = QUESTIONS.filter((q) => c.flags[q.id] === "unclear" && (c.attempts[q.id] ?? 0) >= MAX_ATTEMPTS);
    for (const q of skipped) told.push(`Didn't give a clear answer to: "${q.q}"`);
    if (!c.done) told.push(`Lumi is still talking with ${this.names.owner}…`);
    else if (!told.length) told.push("Nothing unusual in the answers");

    const base = {
      score,
      scoreTrail: c.scoreTrail ?? [],
      whyFlagged: req.assessment.signals.map((s) => s.text),
      told,
      basedOn: c.lines.length,
    };
    const template = this.templateBrief(req, floorHigh);

    if (!this.model) return { ...base, ...template, source: "script" };
    try {
      const out = await this.model.generate({ system: BRIEF_SYSTEM, user: this.briefInput(req, told), schema: BriefOutput, maxTokens: 700 });
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
    const quick = new Set(QUESTIONS.flatMap((q) => q.quick.map((t) => t.toLowerCase())));
    const pattern = req.conversation.pattern;
    const read =
      pattern === "investment"
        ? `This matches a common investment scam: an online contact, a platform where money seems to grow, then a fee to withdraw. We suggest calling ${owner} before you decide.`
        : pattern === "impersonation"
          ? `This matches a common impersonation scam: someone posing as a bank or company is guiding ${owner} right now. We suggest calling ${owner} before you decide.`
          : high
            ? `The transfer itself matches a known scam pattern, even though the answers don't. We suggest calling ${owner} before you decide.`
            : `This is unusual for ${owner}, but the answers don't match a known scam pattern. A quick call is still a good idea.`;
    return {
      risk: high ? ("high" as const) : ("elevated" as const),
      headline: `${owner} wants to send ${money(req.amount)} USDC to ${req.label}`,
      // Only what he typed himself; tapped quick replies are already in the "told" lines.
      inTheirWords: req.conversation.lines
        .filter((l) => l.from === "owner" && !quick.has(l.text.toLowerCase()))
        .slice(-3)
        .map((l) => `"${l.text}"`),
      ourRead: read,
      suggestedAction: high ? ("call_first" as const) : ("call_if_unsure" as const),
    };
  }

  private briefInput(req: TransferRequest, told: string[]): string {
    const c = req.conversation;
    return [
      `Owner: ${this.names.owner}. Guardian: ${this.names.guardian}.`,
      `Transfer: ${money(req.amount)} USDC to "${req.label}"${req.assessment.isNewAddress ? " (a new address)" : ""}.`,
      `Rule-based signals:\n${req.assessment.signals.map((s) => `- [${s.code}] ${s.text}`).join("\n")}`,
      `Settled facts: ${JSON.stringify(c.flags)}. Pattern so far: ${c.pattern}.`,
      `Lines already shown to the guardian:\n${told.map((t) => `- ${t}`).join("\n")}`,
      `Transcript:\n${c.lines.map((l) => (l.from === "owner" ? `<owner_message>${l.text}</owner_message>` : `Lumi: ${l.text}`)).join("\n")}`,
    ].join("\n\n");
  }
}

export type { FlagId };
