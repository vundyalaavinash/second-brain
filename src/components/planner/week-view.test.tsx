// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { WeekView } from "./week-view";
import { resetFocusStore } from "../focus/focus-store";
import { PatchTaskBody } from "@/lib/validation";
import type { PlannerWeekDTO, TaskDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner/week" }));

const START = "2026-09-21";
const TODAY = "2026-09-22";

const task: TaskDTO = {
  id: 4, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: START, containerId: null, sourceItemId: null,
  estimateMinutes: null, sessionMinutes: null, blocks: [], goals: [], spentMinutes: 0, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
};

function week(): PlannerWeekDTO {
  return {
    start: START,
    drift: null,
    days: Array.from({ length: 7 }, (_, i) => {
      const date = `2026-09-${String(21 + i).padStart(2, "0")}`;
      // Monday sits inside its hours; Tuesday is overbooked, so the two tones are both on screen.
      const plannedMinutes = date === START ? 75 : date === "2026-09-22" ? 600 : 0;
      // 2026-09-21 is a Monday, so the first five days (Mon-Fri) are working days and the last
      // two (Sat, Sun) are not — the payload zeroes a non-working day's capacity across the
      // board, the same way the server does, but `WeekView` reads `working` directly rather
      // than infer it from zeros.
      const working = i < 5;
      return {
        date,
        working,
        meetings: [],
        due: date === START ? [task] : [],
        capacity: { freeMinutes: working ? 540 : 0, plannedMinutes, blockedMinutes: 0, forecastMinutes: null },
      };
    }),
  };
}

function mount(): { fetchMock: ReturnType<typeof vi.fn>; onRefresh: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: task.id }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onRefresh = vi.fn();
  render(<WeekView week={week()} today={TODAY} onRefresh={onRefresh} />);
  // The store makes one `/api/focus` call for the whole page on mount, not one per row; cleared
  // so the assertions below only see the calls a test's own action makes.
  fetchMock.mockClear();
  return { fetchMock, onRefresh };
}

/** The column a weekday name sits in: the pane the drop handler is hung on. */
function column(weekday: string): HTMLElement {
  return screen.getByText(weekday).closest(".pane") as HTMLElement;
}

beforeEach(() => {
  resetFocusStore();
});

afterEach(() => {
  cleanup();
  resetFocusStore();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("WeekView", () => {
  it("re-dates a task dropped on another column", () => {
    const { fetchMock } = mount();
    fireEvent.drop(column("Wed"), { dataTransfer: { getData: () => String(task.id) } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/tasks/${task.id}`);
    expect(init.method).toBe("PATCH");
    const body: unknown = JSON.parse(String(init.body));
    expect(body).toEqual({ dueDate: "2026-09-23" });
    // The column sends what the route accepts, not something the route would 400.
    expect(PatchTaskBody.safeParse(body).success).toBe(true);
  });

  it("marks a day that has time blocked on it", () => {
    const w = week();
    w.days[1].capacity.blockedMinutes = 80;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    render(<WeekView week={w} today={TODAY} onRefresh={vi.fn()} />);
    const dot = within(column("Tue")).getByRole("img", { name: "1h 20m blocked" });
    expect(dot.getAttribute("title")).toBe("1h 20m blocked");
    // A day with nothing blocked carries no dot at all.
    expect(within(column("Wed")).queryByRole("img", { name: /blocked/ })).toBeNull();
  });

  it("ignores a drop that carries no task", () => {
    const { fetchMock } = mount();
    fireEvent.drop(column("Wed"), { dataTransfer: { getData: () => "" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what each day already holds against the time it has", () => {
    mount();
    expect(within(column("Mon")).getByText("1h 15m / 9h")).toBeTruthy();
  });

  it("colours a day that is over its hours", () => {
    mount();
    expect(within(column("Mon")).getByText("1h 15m / 9h").className).toContain("text-fg-muted");
    expect(within(column("Tue")).getByText("10h / 9h").className).toContain("text-warn");
  });

  it("shows a non-working day as a quiet gap: the date, and nothing about capacity", () => {
    mount();
    const sat = column("Sat");
    // The date and weekday are still there.
    expect(within(sat).getByText("26")).toBeTruthy();
    expect(within(sat).getByText("Sat")).toBeTruthy();
    // Nothing about capacity: not a figure, not "0h", not a blocked dot.
    expect(within(sat).queryByText(/\/ /)).toBeNull();
    expect(within(sat).queryByText(/0h/)).toBeNull();
    expect(within(sat).queryByRole("img", { name: /blocked/ })).toBeNull();
  });

  it("keeps the blocked dot off a non-working day even when it has blocked minutes", () => {
    const w = week();
    w.days[5].capacity.blockedMinutes = 80;
    render(<WeekView week={w} today={TODAY} onRefresh={vi.fn()} />);
    expect(within(column("Sat")).queryByRole("img", { name: /blocked/ })).toBeNull();
  });

  it("still shows a working day's own capacity — only the non-working days go quiet", () => {
    mount();
    expect(within(column("Mon")).getByText("1h 15m / 9h")).toBeTruthy();
    expect(within(column("Sat")).queryByText(/\/ 9h/)).toBeNull();
  });

  it("plans from the week on screen rather than from today", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan for" }));
    const days = screen.getByRole("menu", { name: "Plan for" });
    expect((days.querySelector('[role="menuitem"]') as HTMLElement).textContent).toBe("Monday 21");
  });
});
