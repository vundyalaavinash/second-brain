// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GoalRow } from "./goal-row";
import type { GoalDTO } from "@/lib/dto";

const goal = (over: Partial<GoalDTO> = {}): GoalDTO => ({
  id: 1, title: "Launch v2", outcome: "Customers are on the new API", horizon: "quarter",
  targetDate: "2026-12-31", status: "active", notes: "", sortOrder: 0, closedAt: null,
  measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: "2026-09-23T10:00:00.000Z", stalled: false },
  containers: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
});

afterEach(cleanup);

describe("GoalRow", () => {
  it("leads with movement and shows progress behind it", () => {
    render(<GoalRow goal={goal()} today="2026-09-24" />);
    const movement = screen.getByText(/2 closed this week/i);
    const ring = screen.getByRole("img", { name: "70% done" });
    // Document order is visual order here: movement is meant to lead the row, progress trails.
    expect(movement.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/70%/)).toBeTruthy();
  });

  it("says a stalled goal is stalled, in words and without alarm", () => {
    render(<GoalRow goal={goal({ measure: { open: 2, done: 0, total: 2, percent: 0, movement: 0, lastClosedAt: null, stalled: true } })} today="2026-09-24" />);
    expect(screen.getByText(/nothing closed on this/i)).toBeTruthy();
  });

  it("counts the days left, and says so when the date has gone", () => {
    render(<GoalRow goal={goal({ targetDate: "2026-09-20" })} today="2026-09-24" />);
    expect(screen.getByText(/4 days overdue/i)).toBeTruthy();
  });
});
