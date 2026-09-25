import { describe, it, expect } from "vitest";
import { weekStart, weekEnd, weekDays, nextWeek, weekLabel, isoWeekday } from "./week";

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

describe("isoWeekday", () => {
  it("counts Monday through Sunday as 1 through 7", () => {
    expect(isoWeekday("2026-09-21")).toBe(1); // Monday
    expect(isoWeekday("2026-09-25")).toBe(5); // Friday
    expect(isoWeekday("2026-09-27")).toBe(7); // Sunday
  });
  it("agrees with weekStart: day 1 of every week is the week's own start", () => {
    for (const day of weekDays("2026-09-21")) {
      expect(isoWeekday(day) === 1).toBe(day === weekStart(day));
    }
  });
});

describe("the rest of the week", () => {
  it("ends on Sunday and holds seven days", () => {
    expect(weekEnd("2026-09-21")).toBe("2026-09-27");
    expect(weekDays("2026-09-21")).toHaveLength(7);
    expect(weekDays("2026-09-21")[6]).toBe("2026-09-27");
  });
  it("names the next week and labels its own, year included", () => {
    expect(nextWeek("2026-09-21")).toBe("2026-09-28");
    expect(weekLabel("2026-09-21")).toBe("Week of 21 September 2026");
  });
});
