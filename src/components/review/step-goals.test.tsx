// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { StepGoals } from "./step-goals";
import type { GoalDTO } from "@/lib/dto";

const TODAY = "2026-09-24";

const goal = (over: Partial<GoalDTO> = {}): GoalDTO => ({
  id: 1,
  title: "Launch v2",
  outcome: "Customers are on the new API",
  horizon: "quarter",
  targetDate: "2026-12-31",
  status: "active",
  notes: "",
  sortOrder: 0,
  closedAt: null,
  measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: "2026-09-23T10:00:00.000Z", stalled: false },
  containers: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

afterEach(cleanup);

describe("StepGoals", () => {
  it("lists each active goal with its own GoalRow and a one-line note box beneath it", () => {
    render(<StepGoals goals={[goal()]} today={TODAY} value={{}} onChange={() => {}} />);
    expect(screen.getByRole("link", { name: "Launch v2" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Note for Launch v2" })).toBeTruthy();
  });

  it("says a stalled goal is stalled, once, in the muted tone — GoalRow's own wording, not repeated here", () => {
    render(<StepGoals goals={[goal({ measure: { open: 2, done: 0, total: 2, percent: 0, movement: 0, lastClosedAt: null, stalled: true } })]} today={TODAY} value={{}} onChange={() => {}} />);
    const matches = screen.getAllByText(/nothing closed on this/i);
    expect(matches).toHaveLength(1);
    expect(matches[0].className).toContain("text-fg-faint");
  });

  it("keys each note by goal id and reports it on change", () => {
    const onChange = vi.fn();
    render(<StepGoals goals={[goal({ id: 7 }), goal({ id: 9, title: "Ship the docs" })]} today={TODAY} value={{ "7": "On track" }} onChange={onChange} />);
    const first = screen.getByRole("textbox", { name: "Note for Launch v2" }) as HTMLInputElement;
    expect(first.value).toBe("On track");
    fireEvent.change(screen.getByRole("textbox", { name: "Note for Ship the docs" }), { target: { value: "Slipping a bit" } });
    expect(onChange).toHaveBeenCalledWith("9", "Slipping a bit");
  });

  it("says so when there are no active goals, rather than rendering an empty list", () => {
    render(<StepGoals goals={[]} today={TODAY} value={{}} onChange={() => {}} />);
    expect(screen.getByText("No active goals to check in on.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});
