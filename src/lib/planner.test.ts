import { describe, it, expect } from "vitest";
import { hasUserNotes } from "./planner";

/** What `captureMeeting` writes into a fresh meeting item. */
const TEMPLATE = [
  "**When:** 2026-09-22 10:30 to 11:00",
  "**Who:** 4 attendees",
  "",
  "## Notes",
  "",
  "## Actions",
  "",
  "- [ ] ",
].join("\n");

describe("hasUserNotes", () => {
  it("does not count the pristine capture template", () => {
    expect(hasUserNotes(TEMPLATE)).toBe(false);
  });

  it("counts text written under Notes", () => {
    expect(hasUserNotes(TEMPLATE.replace("## Notes\n", "## Notes\nAgreed to ship on Friday\n"))).toBe(true);
  });

  it("counts an action that has been filled in", () => {
    expect(hasUserNotes(TEMPLATE.replace("- [ ] ", "- [ ] Email Ada the deck"))).toBe(true);
  });

  it("counts a note that is not the template at all", () => {
    expect(hasUserNotes("Dropped-in recording")).toBe(true);
    expect(hasUserNotes("   ")).toBe(false);
  });
});
