import { describe, expect, it } from "vitest";
import { hasRecapContent, meetingRecap } from "./recap";

const SUMMARY = {
  summary: "The team agreed the Postgres cutover plan and the fraud check rollback.",
  decisions: ["Scheduled the backfill for Tuesday night"],
  proposed_actions: [
    { title: "Book the maintenance window", notes: "Priya, before Tuesday" },
    { title: "Design the async fraud check", notes: "" },
  ],
};

describe("meetingRecap", () => {
  it("reads as something a person can paste and send", () => {
    const text = meetingRecap({ title: "Platform sync", summary: SUMMARY });
    expect(text).toBe(
      [
        "Recap — Platform sync",
        "",
        "The team agreed the Postgres cutover plan and the fraud check rollback.",
        "",
        "Decisions:",
        "- Scheduled the backfill for Tuesday night",
        "",
        "Action items:",
        "- Book the maintenance window (Priya, before Tuesday)",
        "- Design the async fraud check",
        "",
        "Please correct me if I missed anything.",
      ].join("\n"),
    );
  });

  // A heading with nothing under it reads as a broken tool, and the recap is meant to invite a
  // correction -- which only works if what is there is worth reading.
  it("leaves out sections that have nothing in them", () => {
    const text = meetingRecap({
      title: "Standup",
      summary: { summary: "A short status round.", decisions: [], proposed_actions: [] },
    });
    expect(text).not.toContain("Decisions:");
    expect(text).not.toContain("Action items:");
    expect(text).toContain("A short status round.");
  });

  it("ignores blank entries rather than printing empty bullets", () => {
    const text = meetingRecap({
      title: "Standup",
      summary: { summary: "", decisions: ["  "], proposed_actions: [{ title: " ", notes: "x" }] },
    });
    expect(text).not.toContain("Decisions:");
    expect(text).not.toContain("Action items:");
  });

  it("carries the person's own notes, which outrank anything inferred", () => {
    const text = meetingRecap({ title: "1:1", summary: SUMMARY, notes: "Ask about the hiring freeze." });
    expect(text).toContain("My notes:");
    expect(text).toContain("Ask about the hiring freeze.");
  });

  it("always asks to be corrected", () => {
    expect(meetingRecap({ title: "Anything" })).toContain("Please correct me if I missed anything.");
  });

  it("still names the meeting when there is nothing else", () => {
    expect(meetingRecap({ title: "Empty one" })).toContain("Recap — Empty one");
  });
});

describe("hasRecapContent", () => {
  it("is false when there is nothing worth sending", () => {
    expect(hasRecapContent({ title: "Empty" })).toBe(false);
    expect(hasRecapContent({ title: "Empty", summary: { summary: " ", decisions: [], proposed_actions: [] } })).toBe(false);
  });

  it("is true on a summary, a decision, an action, or notes alone", () => {
    expect(hasRecapContent({ title: "x", summary: { summary: "said things", decisions: [], proposed_actions: [] } })).toBe(true);
    expect(hasRecapContent({ title: "x", summary: { summary: "", decisions: ["chose a date"], proposed_actions: [] } })).toBe(true);
    expect(hasRecapContent({ title: "x", summary: { summary: "", decisions: [], proposed_actions: [{ title: "do it", notes: "" }] } })).toBe(true);
    expect(hasRecapContent({ title: "x", notes: "my own note" })).toBe(true);
  });
});
