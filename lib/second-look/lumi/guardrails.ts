/**
 * Everything the model writes passes through here before anyone sees it.
 * The model can add warning signs; it can never remove them, approve, or sign.
 */

const FORBIDDEN: RegExp[] = [
  /\b(approv(e|ed|al)|authori[sz]e|co-?sign(ed)?)\b/i,
  /\b(safe|fine|ok|okay|legit(imate)?|genuine|real)\s+to\s+(send|transfer|pay|go)\b/i,
  /\b(it'?s|this is|looks|seems)\s+(safe|legit(imate)?|genuine|fine|ok(ay)?)\b/i,
  /\b(go ahead|send it|you should send|you can send|just send|proceed)\b/i,
  /\b(seed|recovery|secret)\s+(phrase|words?)\b/i,
  /\b(private key|password|pin code)\b/i,
  /\bguaranteed?\b/i,
];

const URL = /\b(https?:\/\/|www\.)\S+/i;
const ADDRESS = /\b0x[0-9a-f]{6,}\b/i;
const PHONE = /\+?\d[\d\s().-]{7,}\d/;

export const LIMITS = { ack: 220, question: 200, ownerInput: 600, line: 160, read: 320, headline: 140 } as const;

export type Violation = "forbidden" | "url" | "address" | "phone" | "empty";

export function check(text: string): Violation | null {
  const t = text.trim();
  if (!t) return "empty";
  if (URL.test(t)) return "url";
  if (ADDRESS.test(t)) return "address";
  if (PHONE.test(t)) return "phone";
  if (FORBIDDEN.some((r) => r.test(t))) return "forbidden";
  return null;
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}

/** Returns clean text, or the fallback if the model's text breaks a rule. */
export function safeText(text: string | undefined, max: number, fallback: string): { text: string; replaced: boolean } {
  if (text === undefined) return { text: fallback, replaced: true };
  const clipped = clip(text, max);
  return check(clipped) ? { text: fallback, replaced: true } : { text: clipped, replaced: false };
}

/** Owner input is untrusted. Bound its size and strip control characters before it reaches the model. */
export function cleanOwnerInput(text: unknown): string {
  return String(text ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .slice(0, LIMITS.ownerInput)
    .trim();
}
