// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PlannerShell } from "./planner-shell";
import type { PlannerDayDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const CALENDAR = { calendarsSeen: 2, permission: true };

function day(calendar: PlannerDayDTO["calendar"] = CALENDAR): PlannerDayDTO {
  return { date: "2026-09-22", plan: [], unfinishedYesterday: [], due: { overdue: [], today: [] }, meetings: [], calendar };
}

function tabs(): { label: string; selected: string | null }[] {
  return screen.getAllByRole("tab").map((t) => ({ label: t.textContent ?? "", selected: t.getAttribute("aria-selected") }));
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

  it("waits quietly while the helper has not reported yet", () => {
    render(<PlannerShell view="day" today="2026-09-22" initial={day({ calendarsSeen: null, permission: false })} />);
    expect(screen.getByText("Waiting for the activity helper to report calendars")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open Internet Accounts" })).toBeNull();
  });
});
