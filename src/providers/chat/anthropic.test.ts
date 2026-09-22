import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// The SDK is replaced wholesale: no test may reach the real API.
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
  },
}));

import { createAnthropicChatProvider, CHAT_MODEL } from "./anthropic";

const Schema = z.object({ summary: z.string(), decisions: z.array(z.string()) });
const req = { system: "sys", user: "notes", schema: Schema, name: "record", description: "d" };

function answer(over: Record<string, unknown>) {
  return {
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "record", input: { summary: "s", decisions: [] } }],
    ...over,
  };
}

describe("anthropic chat provider", () => {
  beforeEach(() => create.mockReset());

  it("forces one strict tool from the zod schema and parses its input", async () => {
    create.mockResolvedValue(answer({}));
    const out = await createAnthropicChatProvider("k").structured(req);
    expect(out).toEqual({ summary: "s", decisions: [] });
    const sent = create.mock.calls[0][0];
    expect(sent.model).toBe(CHAT_MODEL);
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.tool_choice).toEqual({ type: "tool", name: "record" });
    expect(sent.tools[0].strict).toBe(true);
    expect(sent.tools[0].input_schema.$schema).toBeUndefined();
    expect(sent.tools[0].input_schema.required).toEqual(["summary", "decisions"]);
  });

  it("names the budget when the answer is cut off", async () => {
    create.mockResolvedValue(answer({ stop_reason: "max_tokens", content: [] }));
    await expect(createAnthropicChatProvider("k").structured(req)).rejects.toThrow(/did not fit/);
  });

  it("reports a refusal with its category", async () => {
    create.mockResolvedValue(answer({ stop_reason: "refusal", stop_details: { category: "safety" }, content: [] }));
    await expect(createAnthropicChatProvider("k").structured(req)).rejects.toThrow(/declined: safety/);
  });

  it("fails when the tool was not called", async () => {
    create.mockResolvedValue(answer({ content: [{ type: "text", text: "hi" }] }));
    await expect(createAnthropicChatProvider("k").structured(req)).rejects.toThrow(/without calling record/);
  });
});
