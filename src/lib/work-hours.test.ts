import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { getWorkHours, setWorkHours, getWorkingDays, setWorkingDays, isWorkingDay, DEFAULT_WORKING_DAYS } from "./work-hours";

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
});
afterEach(() => t.cleanup());

describe("work hours", () => {
  it("defaults to 09:00-18:00 and rejects nonsense", () => {
    expect(getWorkHours(t.db)).toBe("09:00-18:00");
    expect(() => setWorkHours(t.db, "not-hours")).toThrow(/HH:MM/);
    expect(setWorkHours(t.db, "08:00-16:00")).toBe("08:00-16:00");
    expect(getWorkHours(t.db)).toBe("08:00-16:00");
  });
});

describe("working days", () => {
  it("defaults to Monday through Friday", () => {
    expect(getWorkingDays(t.db)).toEqual([1, 2, 3, 4, 5]);
    expect(DEFAULT_WORKING_DAYS).toBe("1,2,3,4,5");
  });

  it("saves a new list, deduplicated and sorted", () => {
    expect(setWorkingDays(t.db, [6, 1, 1, 3])).toEqual([1, 3, 6]);
    expect(getWorkingDays(t.db)).toEqual([1, 3, 6]);
  });

  it("rejects an empty list", () => {
    expect(() => setWorkingDays(t.db, [])).toThrow(/at least one/);
  });

  it("rejects a day outside 1-7", () => {
    expect(() => setWorkingDays(t.db, [0, 1])).toThrow(/1 \(Monday\) to 7 \(Sunday\)/);
    expect(() => setWorkingDays(t.db, [1, 8])).toThrow(/1 \(Monday\) to 7 \(Sunday\)/);
  });

  it("reads a working day from local date components, not a UTC parse of the bare date", () => {
    // 2026-09-21 is a Monday, 2026-09-26 a Saturday, 2026-09-27 a Sunday — whatever the
    // machine's own timezone, `new Date("2026-09-26").getDay()` would read UTC midnight, which
    // is still the 25th anywhere west of Greenwich; this must not make that mistake.
    const days = [1, 2, 3, 4, 5];
    expect(isWorkingDay(days, "2026-09-21")).toBe(true); // Monday
    expect(isWorkingDay(days, "2026-09-25")).toBe(true); // Friday
    expect(isWorkingDay(days, "2026-09-26")).toBe(false); // Saturday
    expect(isWorkingDay(days, "2026-09-27")).toBe(false); // Sunday
    expect(isWorkingDay([6, 7], "2026-09-27")).toBe(true); // Sunday is ISO weekday 7
  });

  it("rejects a date that is not YYYY-MM-DD", () => {
    expect(() => isWorkingDay([1], "2026-9-1")).toThrow(/YYYY-MM-DD/);
  });
});
