import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { ChatProvider, StructuredRequest } from "./types";

export const CHAT_MODEL = "claude-opus-5";

/** Enough for a long meeting's summary and its actions; nothing here writes an essay. */
const MAX_TOKENS = 4000;

/**
 * Structured output through a single tool: the zod schema becomes the tool's input schema,
 * the model is forced to call that one tool, and the block it hands back is parsed by the
 * same schema. A malformed answer is a thrown ZodError, which the caller treats as a failure
 * like any other.
 */
export function createAnthropicChatProvider(apiKey: string): ChatProvider {
  const client = new Anthropic({ apiKey });
  return {
    async structured<T>({ system, user, schema, name, description }: StructuredRequest<T>): Promise<T> {
      // `$schema` is metadata the Messages API has no use for; the rest is the object schema.
      const { $schema, ...input_schema } = z.toJSONSchema(schema) as Record<string, unknown>;
      void $schema;
      const res = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system,
        tools: [{ name, description, input_schema: input_schema as Anthropic.Tool["input_schema"] }],
        tool_choice: { type: "tool", name },
        messages: [{ role: "user", content: user }],
      });
      const block = res.content.find((b) => b.type === "tool_use" && b.name === name);
      if (!block || block.type !== "tool_use") throw new Error(`Claude answered without calling ${name}`);
      return schema.parse(block.input);
    },
  };
}
