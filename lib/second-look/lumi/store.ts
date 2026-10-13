import {
  DAY,
  HOUR,
  assess,
  isOpen,
  ruleChangeNeedsGuardian,
  timeline,
  type AccountContext,
  type Contact,
  type PastTransfer,
  type RuleChange,
  type TransferDraft,
} from "../risk";
import { balanceOf, fitsDecimals, fmtAmount, symOf, totalUsd, usd, type Sym } from "../assets";
import type { Lumi, Names } from "./lumi";
import type { GuardRequest, LedgerMessage, PendingSafeTx, TransferRequest } from "./types";

export interface FeedItem {
  ts: number;
  text: string;
}

export interface AccountState {
  guardianActive: boolean;
  dailyLimit: number;
  /** USDC in the account. */
  balance: number;
  /** ETH in the account. */
  ethBalance?: number;
  /** Other tokens (EURC, LINK, …) by symbol. */
  balances?: Record<string, number>;
  allowlist: Contact[];
  /** `amount` is the USD value (what the risk rules and the daily limit count); `tokenAmount` + `token` is what moved. */
  history: (PastTransfer & { label: string; txHash?: string; requestId?: string; token?: Sym; tokenAmount?: number })[];
  flagged: string[];
  requests: GuardRequest[];
  /** Heads-ups for the guardian (yellow transfers, lowered limit). No action needed. */
  fyi: FeedItem[];
  /** Guardian's decisions and expiries. */
  log: FeedItem[];
  /** Reminders sent to the guardian. A real deployment would push or email these. */
  notifications: FeedItem[];
}

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export function demoAccount(now: number, protectedFromStart = true): AccountState {
  const grocery = "0x9c21a4b7e6d35f0812c4aa93e7b10d58f6e2c1a0";
  const pharmacy = "0x41e8d07c93b2a6f15e40c7d28b9a3e61f0d4b752";
  const mia = "0x6b0f3a9e21c84d57b1e9a06f3c28d4e75a91b3c8";
  return {
    guardianActive: protectedFromStart,
    dailyLimit: 200,
    balance: 8060,
    ethBalance: 1.2,
    allowlist: [
      { addr: grocery, label: "Corner grocery" },
      { addr: pharmacy, label: "Riverside pharmacy" },
      { addr: mia, label: "Mia" },
    ],
    history: [
      { addr: grocery, label: "Corner grocery", amount: 38, ts: now - 2 * DAY },
      { addr: pharmacy, label: "Riverside pharmacy", amount: 24, ts: now - 3 * DAY },
      { addr: "0x7a3f9e21b04d5c88a6f13e27d90b4f61a52ec91e", label: '"Trading platform"', amount: 200, ts: now - 4 * DAY },
      { addr: grocery, label: "Corner grocery", amount: 45, ts: now - 6 * DAY },
      { addr: mia, label: "Mia", amount: 60, ts: now - 9 * DAY },
    ],
    flagged: ["0xdead00000000000000000000000000000000beef"],
    requests: [],
    fyi: [],
    log: [],
    notifications: [],
  };
}

/** Live mode: the real Safe. No seeded history; balance and limit come from the chain. */
export function liveAccount(): AccountState {
  return {
    guardianActive: true,
    dailyLimit: Number(process.env.DAILY_LIMIT_USDC ?? 200),
    balance: 0,
    ethBalance: 0,
    balances: {},
    allowlist: [],
    history: [],
    flagged: ["0xdead00000000000000000000000000000000beef"],
    requests: [],
    fyi: [],
    log: [],
    notifications: [],
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * In-memory account and request queue. One account, because the demo is one family.
 * The real source of truth for money is the Safe on-chain; this store holds the
 * conversation, the brief and the signatures collected so far.
 */
export class Store {
  state: AccountState;
  clockOffset = 0;

  constructor(
    private lumi: Lumi,
    private names: Names,
    private realNow: () => number = Date.now,
    private protectedFromStart = true,
    readonly mode: "demo" | "live" = "demo",
  ) {
    this.state = this.fresh();
  }

  private fresh(): AccountState {
    return this.mode === "live" ? liveAccount() : demoAccount(this.now(), this.protectedFromStart);
  }

  /** Live mode keeps the balance and the daily limit in step with the chain. */
  syncChain(c: { balance?: number; ethBalance?: number; balances?: Record<string, number>; dailyLimit?: number }) {
    if (c.balances) this.state.balances = { ...this.state.balances, ...c.balances };
    if (c.balance !== undefined) this.state.balance = c.balance;
    if (c.ethBalance !== undefined) this.state.ethBalance = c.ethBalance;
    if (c.dailyLimit !== undefined && c.dailyLimit >= 0) this.state.dailyLimit = c.dailyLimit;
  }

  snapshot() {
    return { state: this.state, clockOffset: this.clockOffset };
  }

  restore(s: { state: AccountState; clockOffset: number }) {
    this.state = s.state;
    this.clockOffset = s.clockOffset;
  }

  now(): number {
    return this.realNow() + this.clockOffset;
  }

  reset() {
    this.clockOffset = 0;
    this.state = this.fresh();
  }

  advance(hours: number) {
    this.clockOffset += hours * HOUR;
    this.tick();
  }

  context(): AccountContext {
    const s = this.state;
    // Risk rules see the whole account in USD
    return { dailyLimit: s.dailyLimit, balance: totalUsd(s), allowlist: s.allowlist, history: s.history, flagged: s.flagged, now: this.now() };
  }

  openRequest(): GuardRequest | undefined {
    return this.state.requests.find((r) => isOpen(r.status));
  }

  get(id: string): GuardRequest {
    this.tick();
    const r = this.state.requests.find((x) => x.id === id);
    if (!r) throw new HttpError(404, "No such request");
    return r;
  }

  getTransfer(id: string): TransferRequest {
    const r = this.get(id);
    if (r.kind !== "transfer") throw new HttpError(400, "Not a transfer request");
    return r;
  }

  /** Expire open requests after 24h and record reminders as they come due. Never approves anything. */
  tick() {
    const now = this.now();
    for (const r of this.state.requests) {
      if (!isOpen(r.status)) continue;
      const t = timeline(r.createdAt, now);
      const due = Math.min(t.remindersDue, 3);
      for (let i = r.remindersSent ?? 0; i < due; i++)
        this.state.notifications.unshift({ ts: now, text: `Reminder ${i + 1} of 3 sent to ${this.names.guardian}: ${describe(r)}` });
      r.remindersSent = Math.max(r.remindersSent ?? 0, due);
      if (t.expired) {
        r.status = "expired";
        r.decidedAt = now;
        this.state.log.unshift({ ts: now, text: `${describe(r)}: expired with no response, nothing moved` });
      }
    }
  }

  /** Owner starts a transfer. Green and yellow go out under the on-chain allowance; red opens a request. */
  startTransfer(draft: TransferDraft & { label?: string; txHash?: string; route?: "allowance" | "guardian"; token?: Sym }) {
    this.tick();
    if (!this.state.guardianActive) throw new HttpError(409, "Protection isn't set up yet");
    if (!/^0x[0-9a-fA-F]{40}$/.test(draft.to)) throw new HttpError(400, "That address doesn't look right");
    if (!(draft.amount > 0)) throw new HttpError(400, "Enter an amount above 0");
    const token = symOf(draft);
    if (!fitsDecimals(draft.amount, token)) throw new HttpError(400, `Too many decimals for ${token}`);
    const balance = balanceOf(this.state, token);
    // Live mode reads the balance from the chain; if that read failed (0), let the Safe itself refuse.
    if ((this.mode === "demo" || balance > 0) && draft.amount > balance) throw new HttpError(400, `That's more than your ${token} balance`);
    const label = (draft.label ?? "").trim() || "New contact";
    const assessment = assess({ ...draft, amount: usd(draft.amount, token) }, this.context());

    // Low risk but the Safe has no daily allowance set up yet: it still needs Mia, without a chat.
    if (assessment.tier !== "red" && draft.route === "guardian") {
      if (this.openRequest()) throw new HttpError(409, `One request is already waiting on ${this.names.guardian}`);
      const conversation = { ...this.lumi.open({ assessment }), lines: [], done: true };
      const request: TransferRequest = { id: `r${this.now().toString(36)}`, kind: "transfer", createdAt: this.now(), status: "pending", to: draft.to, label, amount: draft.amount, token, assessment, conversation };
      this.state.requests.unshift(request);
      this.tick();
      return { assessment, request };
    }

    if (assessment.tier !== "red") {
      this.recordTransfer(draft.to, label, token, draft.amount, draft.txHash);
      if (assessment.notifyGuardian)
        this.state.fyi.unshift({ ts: this.now(), text: `${this.names.owner} sent ${fmtAmount(draft.amount, token)} to ${label} (new address)` });
      return { assessment, request: null };
    }

    if (this.openRequest()) throw new HttpError(409, `One request is already waiting on ${this.names.guardian}`);
    const base = { assessment };
    const request: TransferRequest = {
      id: `r${this.now().toString(36)}`,
      kind: "transfer",
      createdAt: this.now(),
      status: "chat",
      to: draft.to,
      label,
      amount: draft.amount,
      token,
      assessment,
      conversation: this.lumi.open(base),
    };
    this.state.requests.unshift(request);
    this.tick();
    return { assessment, request };
  }

  async answer(id: string, input: { text?: string; quick?: 0 | 1 }) {
    const r = this.getTransfer(id);
    if (r.status !== "chat") throw new HttpError(409, "This conversation is closed");
    r.conversation = await this.lumi.turn(r, input);
    return r;
  }

  async brief(id: string) {
    const r = this.getTransfer(id);
    r.brief = await this.lumi.brief(r);
    return r.brief;
  }

  /** Owner sends the request on to the guardian, optionally with a Safe transaction they already signed. */
  submit(id: string, safeTx?: PendingSafeTx) {
    const r = this.get(id);
    if (r.status !== "chat" && r.status !== "pending") throw new HttpError(409, "This request is closed");
    r.status = "pending";
    if (safeTx) r.safeTx = safeTx;
    return r;
  }

  cancel(id: string) {
    const r = this.get(id);
    if (!isOpen(r.status)) throw new HttpError(409, "This request is closed");
    r.status = "cancelled";
    r.decidedAt = this.now();
    return r;
  }

  /**
   * Guardian's decision. The signature comes from her Ledger in the browser; the server only
   * records it. Approving without a signature is allowed in demo mode (simulated device).
   */
  decide(id: string, d: { decision: "approve" | "reject"; note?: string; signature?: { signer: string; data: string }; executedTxHash?: string; ledger?: LedgerMessage }) {
    const r = this.get(id);
    if (!isOpen(r.status)) throw new HttpError(409, "This request is closed");
    const ok = d.decision === "approve";
    // When a real Safe transaction is attached, approval only counts with the guardian's device signature.
    if (ok && r.safeTx && !d.signature) throw new HttpError(400, "Approving needs the signature from your Ledger");
    r.status = ok ? "approved" : "rejected";
    r.decidedAt = this.now();
    r.note = d.note?.slice(0, 280);
    if (r.safeTx && d.signature) r.safeTx.signatures.push(d.signature);
    if (r.safeTx && d.executedTxHash) r.safeTx.executedTxHash = d.executedTxHash;
    if (d.ledger) r.ledger = d.ledger;
    this.state.log.unshift({ ts: this.now(), text: `${ok ? "Approved" : "Rejected"}: ${describe(r)}` });

    if (ok && r.kind === "transfer") {
      this.recordTransfer(r.to, r.label, symOf(r), r.amount, d.executedTxHash, r.id);
      if (!this.state.allowlist.some((c) => c.addr.toLowerCase() === r.to.toLowerCase())) this.state.allowlist.push({ addr: r.to, label: r.label });
    }
    if (ok && r.kind === "rule") this.applyRule(r.change);
    return r;
  }

  /** Dad's wallet reports the on-chain execution once both signatures are in. */
  executed(id: string, txHash: string) {
    const r = this.get(id);
    if (r.status !== "approved" || !r.safeTx) throw new HttpError(409, "Nothing to execute");
    r.safeTx.executedTxHash = txHash;
    const h = this.state.history.find((x) => x.requestId === r.id);
    if (h) h.txHash = txHash;
    return r;
  }

  /** Rule changes. Tightening applies now; loosening becomes a request for the guardian. */
  changeRule(change: RuleChange) {
    this.tick();
    if (!ruleChangeNeedsGuardian(change)) {
      this.applyRule(change);
      this.state.fyi.unshift({ ts: this.now(), text: `${this.names.owner} lowered the daily limit to ${money((change as { to: number }).to)} USDC` });
      return { applied: true as const, request: null };
    }
    if (this.openRequest()) throw new HttpError(409, `One request is already waiting on ${this.names.guardian}`);
    const { title, detail } = this.describeRule(change);
    const request: GuardRequest = { id: `r${this.now().toString(36)}`, kind: "rule", createdAt: this.now(), status: "pending", change, title, detail };
    this.state.requests.unshift(request);
    this.tick();
    return { applied: false as const, request };
  }

  private applyRule(change: RuleChange) {
    if (change.kind === "limit") this.state.dailyLimit = change.to;
    if (change.kind === "allow") this.state.allowlist.push({ addr: change.addr, label: change.label });
    if (change.kind === "removeGuardian") this.state.guardianActive = false;
    if (change.kind === "enableProtection") {
      this.state.guardianActive = true;
      this.state.dailyLimit = change.limit;
    }
  }

  private describeRule(change: RuleChange): { title: string; detail: string } {
    const { owner } = this.names;
    if (change.kind === "limit")
      return {
        title: `Raise ${owner}'s daily limit to ${money(change.to)} USDC`,
        detail: `Right now ${owner} can send up to ${money(change.from)} USDC a day on his own. This would raise it to ${money(change.to)} USDC.`,
      };
    if (change.kind === "allow")
      return {
        title: `Add ${change.label} to ${owner}'s trusted contacts`,
        detail: `Transfers to ${short(change.addr)} would no longer be flagged as a new address. Transfers above the daily limit still need you.`,
      };
    if (change.kind === "enableProtection")
      return {
        title: `Become ${owner}'s guardian`,
        detail: `${owner} chose a daily limit of ${money(change.limit)} USDC. Anything above it, and any change that loosens protection, will need your Ledger.`,
      };
    return { title: `Remove you as ${owner}'s guardian`, detail: `${owner} would be able to send any amount without a second look.` };
  }

  private recordTransfer(addr: string, label: string, token: Sym, amount: number, txHash?: string, requestId?: string) {
    this.state.history.unshift({ addr, label, amount: usd(amount, token), token, tokenAmount: amount, ts: this.now(), txHash, requestId });
    if (token === "USDC") this.state.balance -= amount;
    else if (token === "ETH") this.state.ethBalance = (this.state.ethBalance ?? 0) - amount;
    else this.state.balances = { ...this.state.balances, [token]: balanceOf(this.state, token) - amount };
  }
}

function describe(r: GuardRequest): string {
  return r.kind === "transfer" ? `${fmtAmount(r.amount, symOf(r))} to ${r.label}` : r.title;
}
