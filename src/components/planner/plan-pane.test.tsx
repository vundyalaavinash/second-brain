// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { PlanPane } from "./plan-pane";
import { CarryOverBody } from "@/lib/validation";
import type { PlannerDayDTO, PlanTaskDTO, TaskDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const TODAY = "2026-09-22";

const base: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
};
const planned: PlanTaskDTO = { ...base, id: 2, title: "Write the brief", planId: 9, sortOrder: 0 };

function day(date: string): PlannerDayDTO {
  return {
    date,
    plan: [planned],
    unfinishedYesterday: [base],
    due: { overdue: [], today: [base] },
    meetings: [],
    calendar: { calendarsSeen: 2, permission: true },
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
  };
}

function mount(date = TODAY) {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const onRefresh = vi.fn();
  render(<PlanPane day={day(date)} today={TODAY} onRefresh={onRefresh} />);
  return { fetchMock, onRefresh };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("PlanPane", () => {
  it("carries yesterday's unfinished tasks onto the day being shown", () => {
    const { fetchMock } = mount("2026-09-24");
    fireEvent.click(screen.getByRole("button", { name: "Carry over" }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/plan/carry-over");
    expect(init.method).toBe("POST");
    const body: unknown = JSON.parse(String(init.body));
    expect(body).toEqual({ from: "2026-09-23", to: "2026-09-24" });
    expect(CarryOverBody.safeParse(body).success).toBe(true);
  });

  it("reloads the day when anything announces a plan change", () => {
    const { onRefresh } = mount();
    act(() => {
      window.dispatchEvent(new Event("sb:plan-changed"));
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new Event("sb:tasks-changed"));
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("names the plan item after today only while today is the day on screen", () => {
    mount();
    // The second row is the due one: the planned row above it offers to remove instead.
    fireEvent.click(screen.getAllByRole("button", { name: "Task actions" })[1]);
    expect(screen.getByRole("menuitem", { name: "Plan for today" })).toBeTruthy();
    cleanup();

    mount("2026-09-24");
    fireEvent.click(screen.getAllByRole("button", { name: "Task actions" })[1]);
    expect(screen.getByRole("menuitem", { name: "Plan for this day" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Plan for today" })).toBeNull();
  });
});
