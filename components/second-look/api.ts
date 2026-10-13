import type { Sym } from "@/lib/second-look/assets";
import type { Assessment, Contact, Flags, Pattern, RequestStatus, RiskScore, RuleChange } from "@/lib/second-look/risk";

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
  attempts: Partial<Record<keyof Flags, number>>;
  source: "ai" | "script";
}

export interface SafeTxWire {
  safeAddress: string;
  safeVersion?: string;
  chainId: number;
  data: Record<string, unknown>;
  safeTxHash: string;
  signatures: { signer: string; data: string }[];
  executedTxHash?: string;
}

interface Base {
  id: string;
  createdAt: number;
  status: RequestStatus;
  note?: string;
  safeTx?: SafeTxWire;
  ledger?: { signer: string; message: string; signature: string };
  remindersSent?: number;
  timeline?: { expired: boolean; expiresInMs: number; remindersDue: number };
}
export interface TransferReq extends Base {
  kind: "transfer";
  to: string;
  label: string;
  amount: number;
  token?: Sym;
  assessment: Assessment;
  conversation: Conversation;
}
export interface RuleReq extends Base {
  kind: "rule";
  change: RuleChange;
  title: string;
  detail: string;
}
export type Req = TransferReq | RuleReq;

export interface Brief {
  score: RiskScore;
  scoreTrail: number[];
  risk: "high" | "elevated";
  headline: string;
  whyFlagged: string[];
  told: string[];
  inTheirWords: string[];
  ourRead: string;
  suggestedAction: "call_first" | "call_if_unsure";
  source: "ai" | "script";
}

export interface Feed {
  ts: number;
  text: string;
}

export interface State {
  mode: "demo" | "live";
  /** Live mode: the Safe and the two owners from /setup. */
  safe: string | null;
  owner: string | null;
  guardian: string | null;
  now: number;
  names: { owner: string; guardian: string };
  ai: { model: string } | null;
  account: {
    guardianActive: boolean;
    dailyLimit: number;
    balance: number;
    ethBalance?: number;
    balances?: Record<string, number>;
    allowlist: Contact[];
    /** amount = USD value; tokenAmount + token = what moved */
    history: { addr: string; label: string; amount: number; ts: number; txHash?: string; token?: Sym; tokenAmount?: number }[];
  };
  remainingToday: number;
  open: Req | null;
  latest: Req | null;
  fyi: Feed[];
  log: Feed[];
  notifications: Feed[];
}

export interface Setup {
  safeAddress: string;
  ownerAddress: string;
  ownerName: string;
  guardianAddress: string;
  guardianName: string;
}

/** The Safe + owner wallet for owner-client calls (live mode only). */
export const liveOf = (s: State) => ({ safe: s.safe!, owner: s.owner! });

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/sl${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface AssessResult {
  assessment: Assessment;
  /** "allowance": goes out now under the daily limit. "guardian": needs Mia. */
  route: "allowance" | "guardian";
  allowance: { enabled: boolean; limit: number; spent: number; remaining: number };
}

export const api = {
  state: () => call<State>("/state"),
  assess: (d: { to: string; amount: number; token?: Sym; pasted?: boolean; owner?: string }) => call<AssessResult>("/assess", d),
  transfer: (d: { to: string; amount: number; token?: Sym; label?: string; pasted?: boolean; txHash?: string; route?: "allowance" | "guardian" }) =>
    call<{ assessment: Assessment; request: Req | null }>("/transfers", d),
  turn: (id: string, body: { text?: string; quick?: 0 | 1 }) => call<TransferReq>(`/requests/${id}/turn`, body),
  submit: (id: string) => call<Req>(`/requests/${id}/submit`, {}),
  cancel: (id: string) => call<Req>(`/requests/${id}/cancel`, {}),
  brief: (id: string) => call<Brief>(`/requests/${id}/brief`),
  decide: (id: string, body: { decision: "approve" | "reject"; note?: string }) => call<Req>(`/requests/${id}/decision`, body),
  guardianApprove: (id: string) => call<Req>(`/requests/${id}/guardian-approve`, {}),
  guardianReject: (id: string, body: { note?: string }) => call<Req>(`/requests/${id}/guardian-reject`, body),
  setup: () => call<Setup | null>("/setup"),
  saveSetup: (body: { safeAddress: string; owner: string; ownerName: string; guardianName: string }) => call<Setup>("/setup", body),
  clearSetup: () => call<null>("/setup/clear", {}),
  guardianConfirm: (id: string, body: { signer: string; signature: string }) => call<Req>(`/requests/${id}/guardian-confirm`, body),
  rule: (change: RuleChange) => call<{ applied: boolean; request: Req | null }>("/rules", change),
  reset: () => call<State>("/demo/reset", {}),
  clock: (hours: number) => call<State>("/demo/clock", { hours }),
};

export const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export type OpenReq = Req & { status: "chat" | "pending" };
export const isOpen = (r: Req | null | undefined): r is OpenReq => !!r && (r.status === "chat" || r.status === "pending");

export function ago(ts: number, now: number): string {
  const h = (now - ts) / 3_600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

export const hoursLeft = (r: Req, now: number) => Math.max(0, Math.ceil((24 * 3_600_000 - (now - r.createdAt)) / 3_600_000));
