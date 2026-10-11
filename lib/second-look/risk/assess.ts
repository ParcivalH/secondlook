import type { AccountContext, Assessment, Signal, Tier, TransferDraft } from "./types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Tunables. Kept in one place so the README and the tests can point at them. */
export const RULES = {
  largeVsUsualMultiple: 3,
  largeShareOfBalance: 0.3,
  smallThenLargeMultiple: 5,
  /** Prior transfers to the same new address within 24h that make this one a burst (this would be the 3rd). */
  burstPriorCount: 2,
  freshAddressDays: 7,
  lateNightBeforeHour: 6,
  /** Used when there is no history yet. */
  defaultMedian: 50,
} as const;

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const lc = (a: string) => a.toLowerCase();

export function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function spentToday(ctx: AccountContext): number {
  const start = startOfUtcDay(ctx.now);
  return ctx.history.filter((h) => h.ts >= start && h.ts <= ctx.now).reduce((s, h) => s + h.amount, 0);
}

export function medianAmount(ctx: AccountContext): number {
  const xs = ctx.history.map((h) => h.amount).sort((a, b) => a - b);
  if (!xs.length) return RULES.defaultMedian;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

export function isKnown(ctx: AccountContext, addr: string): boolean {
  return ctx.allowlist.some((c) => lc(c.addr) === lc(addr));
}

/**
 * Deterministic risk assessment. No AI is involved here: the tier decides whether the
 * guardian must sign, and the AI is never allowed to lower it.
 */
export function assess(draft: TransferDraft, ctx: AccountContext): Assessment {
  const addr = lc(draft.to);
  const amt = draft.amount;
  const signals: Signal[] = [];

  const remainingToday = Math.max(0, ctx.dailyLimit - spentToday(ctx));
  const isNewAddress = !isKnown(ctx, addr);
  const prior = ctx.history.filter((h) => lc(h.addr) === addr);
  const priorDay = prior.filter((h) => ctx.now - h.ts < DAY);
  const median = medianAmount(ctx);
  const hour = ctx.localHour ?? new Date(ctx.now).getUTCHours();

  const overLimit = amt > remainingToday;
  const flagged = (ctx.flagged ?? []).map(lc).includes(addr);
  const smallThenLarge = isNewAddress && prior.some((h) => h.amount * RULES.smallThenLargeMultiple <= amt);
  const burst = isNewAddress && priorDay.length >= RULES.burstPriorCount;
  const largeVsUsual = amt > median * RULES.largeVsUsualMultiple;
  const largeShare = ctx.balance > 0 && amt > ctx.balance * RULES.largeShareOfBalance;
  const fresh = isNewAddress && ctx.recipientAgeDays !== undefined && ctx.recipientAgeDays < RULES.freshAddressDays;
  const late = hour < RULES.lateNightBeforeHour;

  if (overLimit)
    signals.push({
      code: "OVER_LIMIT",
      hard: true,
      text: `Above what's left of today's limit (${fmt(remainingToday)} of ${fmt(ctx.dailyLimit)} USDC). The account itself enforces this.`,
    });
  if (flagged) signals.push({ code: "FLAGGED_ADDRESS", text: "This address is on a list of reported scam addresses" });
  if (isNewAddress && !prior.length) signals.push({ code: "NEW_ADDRESS", text: "An address you've never sent to before" });
  if (fresh) signals.push({ code: "FRESH_ADDRESS", text: `This address was created ${ctx.recipientAgeDays} days ago` });
  if (smallThenLarge)
    signals.push({ code: "SMALL_THEN_LARGE", text: "You sent a small amount here before, and now a much larger one" });
  if (burst)
    signals.push({ code: "BURST_TO_NEW", text: `This would be transfer number ${priorDay.length + 1} to this new address today` });
  if (largeVsUsual)
    signals.push({ code: "LARGE_VS_USUAL", text: `About ${Math.round(amt / median)}× your usual transfer` });
  if (largeShare)
    signals.push({ code: "LARGE_SHARE", text: `${Math.round((amt / ctx.balance) * 100)}% of your balance` });
  if (draft.pasted && isNewAddress)
    signals.push({ code: "PASTED_ADDRESS", text: "The address was pasted in, not picked from your contacts" });
  if (late) signals.push({ code: "LATE_NIGHT", text: "Sent late at night" });

  let tier: Tier = "green";
  if (overLimit || flagged || smallThenLarge || burst || (isNewAddress && (largeVsUsual || largeShare))) tier = "red";
  else if (isNewAddress) tier = "yellow";

  return {
    tier,
    signals,
    remainingToday,
    overLimit,
    isNewAddress,
    needsGuardian: tier === "red",
    notifyGuardian: tier === "yellow",
  };
}

/** Short reason Lumi uses to open the conversation ("It's above your daily limit"). */
export function openingReason(a: Assessment): string {
  if (a.overLimit && a.signals.length === 1) return "above your daily limit";
  return a.isNewAddress ? "much larger than usual and going somewhere new" : "much larger than usual";
}
