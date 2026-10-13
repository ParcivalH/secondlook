import { z } from "zod/v4";
import { FACT_IDS, PURPOSES, type QuestionId } from "../risk/conversation";

const fact = z.enum(["yes", "no", "unsure", "unclear"]);
const QUESTION_IDS: [QuestionId, ...QuestionId[]] = ["inv_source", "inv_withdrawn", "inv_amount", "sa_who", "remote", "hurry", "help_who", "help_check", "addr_source"];

/** What Claude must return for one conversation turn. Validated before anything is used. */
export const TurnOutput = z.object({
  purpose: z.enum([...PURPOSES, "unclear"]),
  facts: z.object(Object.fromEntries(FACT_IDS.map((id) => [id, fact])) as Record<(typeof FACT_IDS)[number], typeof fact>),
  pattern: z.enum(["investment", "safe_account", "emergency", "none", "unclear"]),
  ack: z.string(),
  asking: z.enum([...QUESTION_IDS, "purpose", "none"]),
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
