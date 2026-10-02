import { describe, expect, it } from "vitest";
import { mergeSummaries } from "./merge-summaries";

describe("mergeSummaries", () => {
  it("keeps every decision from every part, in the order they were first said", () => {
    const merged = mergeSummaries([
      { summary: "First half.", decisions: ["Backfill runs Tuesday night"], proposed_actions: [] },
      { summary: "Second half.", decisions: ["Rollback stays manual"], proposed_actions: [] },
    ]);
    expect(merged.decisions).toEqual(["Backfill runs Tuesday night", "Rollback stays manual"]);
  });

  // Chunks overlap on purpose, so the same decision arriving twice is the expected case, not a
  // surprise -- but only when it is genuinely the same decision.
  it("collapses a decision repeated across the overlap, whatever the casing or trailing full stop", () => {
    const merged = mergeSummaries([
      { decisions: ["Backfill runs Tuesday night"] },
      { decisions: ["backfill runs tuesday night."] },
      { decisions: ["Backfill   runs Tuesday night"] },
    ]);
    expect(merged.decisions).toEqual(["Backfill runs Tuesday night"]);
  });

  /** The conservative half of the bargain: two decisions that merely look alike are two decisions.
   *  Duplication is something a person can see and ignore; a dropped decision is invisible. */
  it("keeps two decisions that are similar but not the same", () => {
    const merged = mergeSummaries([
      { decisions: ["Backfill runs Tuesday night"] },
      { decisions: ["Backfill runs Wednesday night"] },
    ]);
    expect(merged.decisions).toHaveLength(2);
  });

  it("collapses an action repeated across the overlap", () => {
    const merged = mergeSummaries([
      { proposed_actions: [{ title: "Book the maintenance window", notes: "" }] },
      { proposed_actions: [{ title: "book the maintenance window.", notes: "" }] },
    ]);
    expect(merged.proposed_actions).toEqual([{ title: "Book the maintenance window", notes: "" }]);
  });

  // Only one of the two chunks that saw this action also heard who owned it. Taking the note from
  // whichever copy has one is the difference between keeping that and throwing it away.
  it("takes the note from whichever copy of an action actually has one", () => {
    const merged = mergeSummaries([
      { proposed_actions: [{ title: "Book the maintenance window", notes: "" }] },
      { proposed_actions: [{ title: "Book the maintenance window", notes: "Priya, before Tuesday" }] },
    ]);
    expect(merged.proposed_actions).toEqual([{ title: "Book the maintenance window", notes: "Priya, before Tuesday" }]);
  });

  it("uses the written-over narrative as the paragraph when there is one", () => {
    const merged = mergeSummaries([{ summary: "First half." }, { summary: "Second half." }], "The whole meeting, in one paragraph.");
    expect(merged.summary).toBe("The whole meeting, in one paragraph.");
  });

  /** The reduce pass is allowed to fail -- it is one more model call on an already long path. When
   *  it does, the parts' own paragraphs are still a complete account, just a longer one. */
  it("falls back to the parts' own paragraphs when there is no narrative", () => {
    const merged = mergeSummaries([{ summary: "First half." }, { summary: "Second half." }]);
    expect(merged.summary).toBe("First half.\n\nSecond half.");
    expect(mergeSummaries([{ summary: "Only half." }], "   ").summary).toBe("Only half.");
  });

  it("drops blank entries rather than carrying empty bullets through", () => {
    const merged = mergeSummaries([{ summary: "  ", decisions: ["", "  "], proposed_actions: [{ title: " ", notes: "x" }] }]);
    expect(merged).toEqual({ summary: "", decisions: [], proposed_actions: [] });
  });

  it("is an empty summary for no parts at all", () => {
    expect(mergeSummaries([])).toEqual({ summary: "", decisions: [], proposed_actions: [] });
  });

  it("copes with parts that omit fields entirely", () => {
    expect(mergeSummaries([{}, { decisions: ["A choice"] }]).decisions).toEqual(["A choice"]);
  });
});
