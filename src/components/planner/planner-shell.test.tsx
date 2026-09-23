// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { PlannerShell } from "./planner-shell";
import { usePlanDate } from "@/lib/plan-date";
import type { PlannerDayDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const CALENDAR = { calendarsSeen: 2, permission: true };

function day(calendar: PlannerDayDTO["calendar"] = CALENDAR): PlannerDayDTO {
  return {
    date: "2026-09-22",
    plan: [],
    unfinishedYesterday: [],
    due: { overdue: [], today: [] },
    meetings: [],
    calendar,
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
  };
}

/** The view tabs, not the source drawer's: the day view nests a tablist of its own. */
function viewTabs(): HTMLElement[] {
  return within(screen.getByRole("tablist", { name: "Planner views" })).getAllByRole("tab");
}

/** The prompt bar's view of the open plan, read through the same hook the bar uses. */
function PlanDateProbe() {
  return <span data-testid="plan-date">{usePlanDate() ?? "none"}</span>;
}

function readPlanDate(): string {
  render(<PlanDateProbe />);
  return screen.getByTestId("plan-date").textContent ?? "";
}

function tabs(): { label: string; selected: string | null }[] {
  return viewTabs().map((t) => ({ label: t.textContent ?? "", selected: t.getAttribute("aria-selected") }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("PlannerShell", () => {
  it("names the three views and marks the open one", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);
    expect(screen.getByRole("tablist", { name: "Planner views" })).toBeTruthy();
    expect(tabs()).toEqual([
      { label: "Day", selected: "true" },
      { label: "Week", selected: "false" },
      { label: "Meetings", selected: "false" },
    ]);
  });

  it("moves the selection with the route", () => {
    render(<PlannerShell view="week" today="2026-09-22" initial={{ start: "2026-09-21", days: [] }} />);
    expect(tabs().map((t) => t.selected)).toEqual(["false", "true", "false"]);
  });

  it("asks for a calendar when the helper can see none", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day({ calendarsSeen: 0, permission: true })} />);
    expect(screen.getByText(/No calendars are visible/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Internet Accounts" })).toBeTruthy();
  });

  it("waits quietly while a permitted helper has not reported yet", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day({ calendarsSeen: null, permission: true })} />);
    expect(screen.getByText("Waiting for the activity helper to report calendars")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Internet Accounts" })).toBeNull();
  });

  it("asks for calendar access rather than waiting when the helper was refused it", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day({ calendarsSeen: null, permission: false })} />);
    expect(screen.queryByText("Waiting for the activity helper to report calendars")).toBeNull();
    expect(screen.getByText(/no calendar access/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Internet Accounts" })).toBeTruthy();
  });

  it("points each tab at the panel the views are rendered in", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(viewTabs()[0].id);
    for (const tab of viewTabs()) expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("plans a prompt-bar task on today while the week on screen holds it, else on its first day", () => {
    render(<PlannerShell view="week" today="2026-09-22" initial={{ start: "2026-09-21", days: [] }} />);
    expect(readPlanDate()).toBe("2026-09-22");
    cleanup();
    render(<PlannerShell view="week" today="2026-09-22" initial={{ start: "2026-10-05", days: [] }} />);
    expect(readPlanDate()).toBe("2026-10-05");
  });
});
