import { describe, it, expect } from "vitest";
import { deadlineLabel, sortProjects, daysBetween } from "./deadline";

const today = "2026-09-16";

describe("deadline helpers", () => {
  it("labels deadlines by urgency", () => {
    expect(deadlineLabel(null, today)).toEqual({ text: "No deadline", tone: "faint" });
    expect(deadlineLabel("2026-09-16", today)).toEqual({ text: "Due today", tone: "warn" });
    expect(deadlineLabel("2026-09-17", today)).toEqual({ text: "1 day left", tone: "muted" });
    expect(deadlineLabel("2026-09-28", today)).toEqual({ text: "12 days left", tone: "muted" });
    expect(deadlineLabel("2026-09-15", today)).toEqual({ text: "1 day overdue", tone: "danger" });
    expect(deadlineLabel("2026-09-13", today)).toEqual({ text: "3 days overdue", tone: "danger" });
  });
  it("counts calendar days across a month boundary", () => {
    expect(daysBetween("2026-09-30", "2026-10-02")).toBe(2);
    expect(daysBetween("2026-10-02", "2026-09-30")).toBe(-2);
  });
  it("sorts overdue first, then nearest, then none, ties by name", () => {
    const list = [
      { name: "b none", deadline: null },
      { name: "Soon", deadline: "2026-09-20" },
      { name: "a none", deadline: null },
      { name: "Late", deadline: "2026-09-10" },
      { name: "Later", deadline: "2026-10-01" },
      { name: "Very late", deadline: "2026-09-01" },
    ];
    expect(sortProjects(list, today).map((p) => p.name)).toEqual(["Very late", "Late", "Soon", "Later", "a none", "b none"]);
  });
});
