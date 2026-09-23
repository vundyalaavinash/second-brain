// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import { DayView } from "./day-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/planner" }));

const TODAY = "2026-09-23";

const loose: TaskDTO = {
  id: 1, title: "Loose one", notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: null, scheduledAt: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
};

function day(): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [],
    unfinishedYesterday: [],
    due: { overdue: [], today: [] },
    meetings: [],
    calendar: { calendarsSeen: 1, permission: true },
    sources: { inbox: [loose], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0 },
  };
}

function mount() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => (String(input) === "/api/meetings/recorder" ? Response.json({ state: "idle", missing: [] }) : Response.json({}))),
  );
  render(<DayView day={day()} today={TODAY} onRefresh={vi.fn()} />);
}

function pickerKey(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "/", metaKey: true });
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

describe("DayView", () => {
  it("writes the plan first, then the timeline, with the picker inside the plan", () => {
    mount();
    const plan = screen.getByRole("list", { name: "Plan" });
    const timeline = screen.getByRole("region", { name: "Timeline" });
    // Tab order is document order: the day's own work comes before the calendar beside it.
    expect(plan.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Add a task for today" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("puts the keyboard in the picker with the drawer key", () => {
    mount();
    pickerKey();
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Add a task for today" }));
    expect(screen.getByRole("listbox", { name: "Tasks to plan" })).toBeTruthy();
  });
});
