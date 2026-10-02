import { describe, it, expect } from "vitest";
import { ContextOverflowError, extractAnswer, llamaCliError } from "./llama-cli-output";

const FOOTER = "\n\n[ Prompt: 120.6 t/s | Generation: 191.8 t/s ]\n\n\nExiting...";

describe("extractAnswer", () => {
  it("pulls the answer out from between the echoed prompt and the stats footer", () => {
    const prompt = "Rewrite the following short quotes as one short, plain paragraph.\n\n- A quote.";
    const stdout = `Loading model...\n\n▄▄ ▄▄\n\n> ${prompt}\nA short paragraph about the quote.${FOOTER}`;
    expect(extractAnswer(stdout, prompt)).toBe("A short paragraph about the quote.");
  });

  // The bug this session found the hard way, building the summary provider: a long prompt (a
  // full meeting transcript) never appears in stdout verbatim -- llama-cli's terminal UI
  // truncates the echo itself, mid-line, replacing the rest with this marker. The model still
  // sees and answers the whole prompt; only the *display* is cut short.
  it("falls back to the truncation marker when the prompt was too long to be echoed in full", () => {
    const prompt = "A very long prompt that will not appear in stdout verbatim because it was truncated for display.";
    const stdout = `Loading model...\n\n> A very long prompt that will not ... (truncated)\n{"summary":"ok"}${FOOTER}`;
    expect(extractAnswer(stdout, prompt)).toBe('{"summary":"ok"}');
  });

  it("falls back to the whole trimmed output when neither the prompt nor the truncation marker is found", () => {
    const stdout = "  something unexpected  ";
    expect(extractAnswer(stdout, "a prompt that never appears")).toBe("something unexpected");
  });

  it("still finds the answer when there is no stats footer at all", () => {
    const prompt = "Say hello.";
    expect(extractAnswer(`> ${prompt}\nHello!`, prompt)).toBe("Hello!");
  });
});

/**
 * `llama-cli` reports a refused prompt on stdout and still exits 0, so `execFile` resolves and
 * neither provider learns anything went wrong. Measured against the real summary model: a 44,233
 * token transcript against its 32,768 window produced exactly the line below, exit code 0, and no
 * answer. The summary provider turned that into "Unexpected token 'E'... is not valid JSON" and
 * the gist provider would have stored it as the gist.
 */
describe("llamaCliError", () => {
  const OVERFLOW = "Error: request (44233 tokens) exceeds the available context size (32768 tokens), try increasing it";

  it("names both numbers, so the message says what to do about it", () => {
    expect(llamaCliError(OVERFLOW)?.message).toBe("the prompt is 44233 tokens but this model's context window is 32768 tokens");
  });

  // The summary job splits a transcript using exactly these two numbers, so they have to arrive as
  // numbers rather than something a caller would have to parse back out of a sentence.
  it("carries the two counts as numbers a caller can act on", () => {
    const err = llamaCliError(OVERFLOW);
    expect(err).toBeInstanceOf(ContextOverflowError);
    expect((err as ContextOverflowError).promptTokens).toBe(44233);
    expect((err as ContextOverflowError).contextTokens).toBe(32768);
  });

  it("finds the refusal even when the banner came through with it", () => {
    expect(llamaCliError(`Loading model...\n\n> something\n${OVERFLOW}`)?.message).toContain("44233 tokens");
  });

  it("passes any other llama-cli error through rather than letting it pose as an answer", () => {
    const err = llamaCliError("Error: failed to load model");
    expect(err?.message).toBe("llama-cli failed: failed to load model");
    expect(err).not.toBeInstanceOf(ContextOverflowError);
  });

  it("is null for a real answer", () => {
    expect(llamaCliError('{"summary":"The team agreed the cutover plan."}')).toBeNull();
    expect(llamaCliError("A short paragraph about the quotes.")).toBeNull();
  });

  // A gist of quotes about error handling is a legitimate answer that opens with the word. Only
  // llama-cli's own `Error: ` prefix counts, never the word on its own.
  it("does not mistake an answer that merely talks about errors for one", () => {
    expect(llamaCliError("Error handling was discussed at length, and Priya owns the retry work.")).toBeNull();
  });
});
