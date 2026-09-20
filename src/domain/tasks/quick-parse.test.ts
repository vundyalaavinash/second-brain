import { describe, it, expect } from "vitest";
import { quickParse } from "./quick-parse";

const now = new Date(2026, 8, 16, 10, 0, 0); // Wednesday 16 September 2026, local

describe("quickParse", () => {
  it("returns the title untouched when nothing matches", () => {
    expect(quickParse("Draft welcome email", now)).toEqual({ title: "Draft welcome email", priority: "normal", dueDate: null });
  });
  it("reads a leading or trailing ! as high priority", () => {
    expect(quickParse("! Call the bank", now)).toEqual({ title: "Call the bank", priority: "high", dueDate: null });
    expect(quickParse("Call the bank!", now)).toEqual({ title: "Call the bank", priority: "high", dueDate: null });
  });
  it("reads today, tomorrow, weekday names, and ISO dates as the due date", () => {
    expect(quickParse("Pay rent today", now).dueDate).toBe("2026-09-16");
    expect(quickParse("Pay rent tomorrow", now).dueDate).toBe("2026-09-17");
    expect(quickParse("Ship it fri", now)).toEqual({ title: "Ship it", priority: "normal", dueDate: "2026-09-18" });
    expect(quickParse("Ship it Wednesday", now).dueDate).toBe("2026-09-16");
    expect(quickParse("Ship it tue", now).dueDate).toBe("2026-09-22");
    expect(quickParse("Ship it 2026-10-01", now)).toEqual({ title: "Ship it", priority: "normal", dueDate: "2026-10-01" });
  });
  it("combines priority and date and trims whitespace", () => {
    expect(quickParse("  Collect 1099 forms fri !  ", now)).toEqual({ title: "Collect 1099 forms", priority: "high", dueDate: "2026-09-18" });
  });
  it("does not eat a word that only looks like a day", () => {
    expect(quickParse("Read Monday's notes", now)).toEqual({ title: "Read Monday's notes", priority: "normal", dueDate: null });
    expect(quickParse("fri", now)).toEqual({ title: "fri", priority: "normal", dueDate: null });
  });
});
