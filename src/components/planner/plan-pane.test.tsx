// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
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
const a: TaskDTO = { ...base, id: 3, title: "First thing" };
const b: TaskDTO = { ...base, id: 4, title: "Second thing" };
const c: TaskDTO = { ...base, id: 5, title: "Dragged in" };
const late: TaskDTO = { ...base, id: 6, title: "Late one", dueDate: "2026-09-20" };

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [planned],
    unfinishedYesterday: [base],
    due: { overdue: [], today: [base] },
    meetings: [],
    calendar: { calendarsSeen: 2, permission: true },
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
    ...over,
  };
}

/** Records every request the pane makes, answering each one with a bare 200. */
function stubPlan() {
  const posts: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({});
    }),
  );
  return posts;
}

function mount(date = TODAY) {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const onRefresh = vi.fn();
  render(<PlanPane day={day({ date })} today={TODAY} onRefresh={onRefresh} />);
  return { fetchMock, onRefresh };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
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

  it("offers to take a planned task off the plan", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(screen.getByRole("menuitem", { name: "Remove from plan" })).toBeTruthy();
  });

  it("no longer lists due tasks itself", () => {
    render(<PlanPane day={day({ due: { overdue: [late], today: [] } })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.queryByText("Due")).toBeNull();
    expect(screen.queryByText("Late one")).toBeNull();
  });

  it("fills the capacity bar and turns it red well past the free time", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { container } = render(
      <PlanPane day={day({ capacity: { freeMinutes: 540, plannedMinutes: 700, unestimated: 0, workHours: "09:00-18:00" } })} today={TODAY} onRefresh={vi.fn()} />,
    );
    const fill = container.querySelector(".bg-danger") as HTMLElement;
    expect(fill).toBeTruthy();
    // Past the free time the bar stops at full rather than running off the track.
    expect(fill.style.width).toBe("100%");
  });

  it("accepts a dragged task at the end and between rows", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...a, planId: 1 }, { ...b, planId: 2 }] })} today={TODAY} onRefresh={vi.fn()} />);
    const dt = { types: ["application/x-sb-task"], getData: () => String(c.id), setData: vi.fn(), effectAllowed: "move", dropEffect: "move" };
    const list = screen.getByRole("list", { name: "Plan" });
    fireEvent.dragOver(list, { dataTransfer: dt });
    expect(list.className).toMatch(/border-violet/);
    fireEvent.drop(screen.getByText(b.title).closest("li")!, { dataTransfer: dt });
    await waitFor(() => expect(posts.map((p) => [p.method, p.body])).toEqual([
      ["POST", { date: TODAY, taskId: c.id }],
      ["PATCH", { date: TODAY, taskIds: [a.id, c.id, b.id] }],
    ]));
  });

  it("opens today's empty plan with the ritual, and not another day's", () => {
    stubPlan();
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.getByRole("list", { name: "Plan the day" })).toBeTruthy();
    cleanup();
    render(<PlanPane day={day({ plan: [], date: "2026-09-24" })} today={TODAY} onRefresh={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull();
    expect(screen.getByText(/Nothing planned\. Add from the sources on the right, or press p on any task/)).toBeTruthy();
  });

  it("does not bring the ritual back once it was done today", async () => {
    stubPlan();
    localStorage.setItem("sb:ritual-done:" + TODAY, "1");
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull());
  });

  it("plans a task dropped past the last row without reordering", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...a, planId: 1 }] })} today={TODAY} onRefresh={vi.fn()} />);
    const dt = { types: ["application/x-sb-task"], getData: () => String(c.id), setData: vi.fn(), effectAllowed: "move", dropEffect: "move" };
    fireEvent.drop(screen.getByRole("list", { name: "Plan" }), { dataTransfer: dt });
    await waitFor(() => expect(posts.map((p) => [p.method, p.body])).toEqual([["POST", { date: TODAY, taskId: c.id }]]));
  });
});
