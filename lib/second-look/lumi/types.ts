import type { Assessment, FlagId, Flags, Pattern, RequestStatus, RiskScore, RuleChange } from "../risk";

export interface ChatLine {
  from: "lumi" | "owner";
  text: string;
  ts: number;
}

export interface Conversation {
  lines: ChatLine[];
  flags: Flags;
  pattern: Pattern;
  done: boolean;
  ownerWantsToStop: boolean;
  /** How many times each question was asked without a clear answer. After two, Lumi moves on. */
  attempts: Partial<Record<FlagId, number>>;
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
  /** Deterministic lines from the settled flags. */
  told: string[];
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
  token?: "USDC" | "ETH";
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
