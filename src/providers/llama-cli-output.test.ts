import { describe, it, expect } from "vitest";
import { extractAnswer } from "./llama-cli-output";

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
