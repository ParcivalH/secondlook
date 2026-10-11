import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod/v4";
const config = { model: process.env.LUMI_MODEL ?? "claude-sonnet-5-5", modelTimeoutMs: Number(process.env.LUMI_TIMEOUT_MS ?? 15000) };

/** The only thing Lumi needs from a model: a validated object for a prompt. Tests swap in a fake. */
export interface StructuredModel {
  readonly name: string;
  generate<S extends z.ZodType>(opts: { system: string; user: string; schema: S; maxTokens: number }): Promise<z.infer<S>>;
}

export class ClaudeModel implements StructuredModel {
  readonly name: string;
  private client: Anthropic;

  constructor(apiKey: string, model = config.model) {
    this.name = model;
    this.client = new Anthropic({ apiKey, timeout: config.modelTimeoutMs, maxRetries: 1 });
  }

  async generate<S extends z.ZodType>({ system, user, schema, maxTokens }: { system: string; user: string; schema: S; maxTokens: number }) {
    const msg = await this.client.messages.parse({
      model: this.name,
      max_tokens: maxTokens,
      // The system prompt is identical on every call, so cache it.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (msg.parsed_output == null) throw new Error(`No structured output (stop_reason: ${msg.stop_reason})`);
    // Parse again with our own schema: the SDK already validated, but this keeps the guarantee local.
    return schema.parse(msg.parsed_output) as z.infer<S>;
  }
}
