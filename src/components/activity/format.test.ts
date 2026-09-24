import { describe, it, expect } from "vitest";
import { formatDuration, fractionOfDay, addDaysLocal, formatDayHeading, formatClock, sinceLabel } from "./format";

describe("activity format", () => {
  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(125 * 60_000)).toBe("2h 05m");
  });
  it("positions instants in the day", () => {
    const noon = new Date(2026, 8, 16, 12, 0, 0).toISOString();
    expect(fractionOfDay(noon, "2026-09-16")).toBeCloseTo(0.5, 5);
    expect(fractionOfDay(new Date(2026, 8, 17, 1).toISOString(), "2026-09-16")).toBe(1);
  });
  it("adds days", () => {
    expect(addDaysLocal("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysLocal("2026-09-01", -1)).toBe("2026-08-31");
  });
  it("formats a day heading without locale APIs", () => {
    expect(formatDayHeading("2026-09-16")).toBe("Wednesday 16 September");
  });
  it("formats a 24-hour clock without locale APIs", () => {
    expect(formatClock(new Date(2026, 8, 16, 9, 5).toISOString())).toBe("09:05");
  });
  it("labels how long ago something was", () => {
    const now = Date.parse("2026-09-23T06:10:00.000Z");
    expect(sinceLabel("2026-09-23T06:09:40.000Z", now)).toBe("just now");
    expect(sinceLabel("2026-09-23T06:00:00.000Z", now)).toBe("10 min ago");
    expect(sinceLabel("2026-09-23T03:00:00.000Z", now)).toBe("3 h ago");
    // Past a day it is a date, not a count of hours nobody would read.
    expect(sinceLabel("2026-09-20T06:00:00.000Z", now)).toBe(new Date("2026-09-20T06:00:00.000Z").toLocaleDateString(undefined, { day: "numeric", month: "short" }));
    // A clock that has drifted behind the timestamp reads "just now", never a negative age.
    expect(sinceLabel("2026-09-23T06:11:00.000Z", now)).toBe("just now");
  });
});
