import { z } from "zod/v4";

const flag = z.enum(["yes", "no", "unclear"]);

/** What Claude must return for one conversation turn. Validated before anything is used. */
export const TurnOutput = z.object({
  flags: z.object({
    remote_guidance: flag,
    met_online: flag,
    never_met: flag,
    unlock_fee: flag,
    secrecy_urgency: flag,
  }),
  pattern: z.enum(["investment", "impersonation", "none", "unclear"]),
  ack: z.string(),
  asking: z.enum(["remote_guidance", "met_online", "never_met", "unlock_fee", "secrecy_urgency", "none"]),
  question: z.string(),
  owner_wants_to_stop: z.boolean(),
});
export type TurnOutput = z.infer<typeof TurnOutput>;

/** What Claude must return for the guardian brief. */
export const BriefOutput = z.object({
  headline: z.string(),
  in_their_words: z.array(z.string()),
  our_read: z.string(),
  risk: z.enum(["high", "elevated"]),
  suggested_action: z.enum(["call_first", "call_if_unsure"]),
});
export type BriefOutput = z.infer<typeof BriefOutput>;
