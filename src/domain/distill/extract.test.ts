import { describe, it, expect } from "vitest";
import { suggestQuotes, verifyQuotes, MIN_QUOTES, MAX_QUOTES, MIN_WORDS } from "./extract";

describe("suggestQuotes", () => {
  it("returns sentences that were genuinely in the text, never more than requested", () => {
    const text =
      "The migration touched every downstream consumer of the events table. " +
      "We agreed to freeze schema changes until the audit finishes. " +
      "Lunch was fine. " +
      "The audit itself is scheduled for next Tuesday with the platform team. " +
      "Nobody signed up to own the rollback plan yet, which is the real risk here.";
    const quotes = suggestQuotes(text, { max: 3 });
    expect(quotes.length).toBeLessThanOrEqual(3);
    for (const q of quotes) expect(text.includes(q)).toBe(true);
  });

  it("preserves the original order of the sentences it picks, not score order", () => {
    const text = "Rare unusual widget. Common word word word word. Another rare unusual gadget.";
    const quotes = suggestQuotes(text, { max: 3 });
    const positions = quotes.map((q) => text.indexOf(q));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("returns fewer than the max when there are fewer candidate sentences", () => {
    const text = "Only one sentence here worth scoring at all.";
    expect(suggestQuotes(text, { max: 5 }).length).toBeLessThanOrEqual(1);
  });

  it("returns nothing for empty or whitespace-only text", () => {
    expect(suggestQuotes("")).toEqual([]);
    expect(suggestQuotes("   \n  ")).toEqual([]);
  });
});

describe("verifyQuotes", () => {
  it("keeps a quote that is an exact substring of the source", () => {
    const source = "The migration touched every downstream consumer of the events table.";
    expect(verifyQuotes(source, ["touched every downstream consumer"])).toEqual(["touched every downstream consumer"]);
  });

  it("drops a quote that is close but not an exact substring", () => {
    const source = "The migration touched every downstream consumer of the events table.";
    // Paraphrased, not verbatim.
    expect(verifyQuotes(source, ["the migration affected every downstream consumer"])).toEqual([]);
  });

  it("drops a quote with different whitespace than the source", () => {
    const source = "Line one.\nLine two.";
    expect(verifyQuotes(source, ["Line one. Line two."])).toEqual([]);
  });

  it("drops a fabricated quote entirely absent from the source", () => {
    const source = "We agreed to freeze schema changes until the audit finishes.";
    expect(verifyQuotes(source, ["We decided to ship immediately"])).toEqual([]);
  });

  it("preserves relative order and drops only the ones that fail", () => {
    const source = "First real sentence here. Second real sentence here.";
    const result = verifyQuotes(source, ["First real sentence here.", "a fake one", "Second real sentence here."]);
    expect(result).toEqual(["First real sentence here.", "Second real sentence here."]);
  });

  it("returns an empty array when given no quotes", () => {
    expect(verifyQuotes("anything", [])).toEqual([]);
  });
});

describe("constants", () => {
  it("are the exact values this feature is specified against", () => {
    expect(MIN_QUOTES).toBe(2);
    expect(MAX_QUOTES).toBe(5);
    expect(MIN_WORDS).toBe(40);
  });
});
