import type { Assessment, Attempts, Facts, Pattern, PatternStep, Purpose, QuestionId, RequestStatus, RiskScore, RuleChange } from "../risk";

export interface ChatLine {
  from: "lumi" | "owner";
  text: string;
  ts: number;
}

export interface Conversation {
  lines: ChatLine[];
  /** What the payment is for. Set once; it picks the questions and can't be changed later. */
  purpose: Purpose | null;
  facts: Facts;
  pattern: Pattern;
  /** The question Lumi is waiting on, or null when the questions are done. */
  asking: QuestionId | "purpose" | null;
  done: boolean;
  ownerWantsToStop: boolean;
  /** How many times each question was asked without a clear answer. After two, Lumi moves on. */
  attempts: Attempts;
  /** Light path: a trusted contact, only above the limit. No questions were asked. */
  light?: boolean;
  /** The one thing Lumi suggested he check himself. */
  selfCheck?: string;
  /** When he chose "I'll check first and come back". The request stays saved; nothing moves. */
  checkingFirst?: number;
  /** When he asked the guardian to call him. */
  callRequested?: number;
  /** Which path produced the latest turn: Claude, or the scripted fallback. */
  source: "ai" | "script";
  /** The guardian's risk score after each turn, starting with the transfer alone. */
  scoreTrail: number[];
}

export interface GuardianBrief {
  /** Deterministic 0–100 score with its breakdown. Never written by the model. */
  score: RiskScore;
  scoreTrail: number[];
  risk: "high" | "elevated";
  headline: string;
  whyFlagged: string[];
  /** Deterministic lines from the settled facts. */
  told: string[];
  /** What he said the payment is for. */
  purpose: string | null;
  /** The known scam this matches, and which of its steps were seen. */
  matches: { name: string; steps: PatternStep[] } | null;
  selfCheck?: string;
  light: boolean;
  checkingFirst?: number;
  callRequested?: number;
  /** Model's faithful paraphrase of what the owner said. */
  inTheirWords: string[];
  ourRead: string;
  suggestedAction: "call_first" | "call_if_unsure";
  source: "ai" | "script";
  /** Number of chat lines the brief was written from, for caching. */
  basedOn: number;
}

/** A Safe transaction waiting for signatures. The agent stores it; it never produces a signature itself. */
export interface PendingSafeTx {
  safeAddress: string;
  safeVersion?: string;
  chainId: number;
  /** SafeTx fields as JSON (to, value, data, operation, nonce, …). */
  data: Record<string, unknown>;
  safeTxHash: string;
  signatures: { signer: string; data: string }[];
  executedTxHash?: string;
}

interface BaseRequest {
  id: string;
  createdAt: number;
  status: RequestStatus;
  note?: string;
  decidedAt?: number;
  remindersSent?: number;
  /** Whether it expired while Dad was still talking with Lumi, or while waiting on the guardian. */
  expiredWhile?: "chat" | "pending";
  safeTx?: PendingSafeTx;
  /** A message Mia signed on her Ledger (reject, or approving an off-chain rule). */
  ledger?: LedgerMessage;
}

export interface LedgerMessage {
  signer: string;
  message: string;
  signature: string;
}

export interface TransferRequest extends BaseRequest {
  kind: "transfer";
  to: string;
  label: string;
  /** In units of `token` (USDC if missing). */
  amount: number;
  /** Symbol from lib/tokens.ts */
  token?: string;
  assessment: Assessment;
  conversation: Conversation;
  brief?: GuardianBrief;
}

export interface RuleRequest extends BaseRequest {
  kind: "rule";
  change: RuleChange;
  title: string;
  detail: string;
}

export type GuardRequest = TransferRequest | RuleRequest;
