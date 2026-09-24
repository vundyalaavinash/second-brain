import { describe, it, expect } from "vitest";
import { weekStart, weekEnd, weekDays, nextWeek, weekLabel } from "./week";

describe("weekStart", () => {
  it("returns the day itself for a Monday", () => {
    expect(weekStart("2026-09-21")).toBe("2026-09-21");
  });
  it("walks back to Monday from mid-week", () => {
    expect(weekStart("2026-09-24")).toBe("2026-09-21");
  });
  it("treats Sunday as the end of the week it closes, not the start of the next", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21");
  });
  it("crosses a month and a year boundary", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
  });
});

describe("the rest of the week", () => {
  it("ends on Sunday and holds seven days", () => {
    expect(weekEnd("2026-09-21")).toBe("2026-09-27");
    expect(weekDays("2026-09-21")).toHaveLength(7);
    expect(weekDays("2026-09-21")[6]).toBe("2026-09-27");
  });
  it("names the next week and labels its own", () => {
    expect(nextWeek("2026-09-21")).toBe("2026-09-28");
    expect(weekLabel("2026-09-21")).toMatch(/21 September/);
  });
});
