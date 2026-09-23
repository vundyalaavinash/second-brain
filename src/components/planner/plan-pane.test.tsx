// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor, within } from "@testing-library/react";
import { PlanPane } from "./plan-pane";
import { CarryOverBody } from "@/lib/validation";
import type { PlannerDayDTO, PlanTaskDTO, TaskDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const TODAY = "2026-09-22";

const base: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: null, scheduledAt: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
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
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [{ container: { id: 10, name: "Launch", slug: "launch", kind: "project" }, tasks: [c] }], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0 },
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
      <PlanPane day={day({ capacity: { freeMinutes: 540, plannedMinutes: 700, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0 } })} today={TODAY} onRefresh={vi.fn()} />,
    );
    const fill = container.querySelector(".bg-danger") as HTMLElement;
    expect(fill).toBeTruthy();
    // Past the free time the bar stops at full rather than running off the track.
    expect(fill.style.width).toBe("100%");
  });

  it("opens today's empty plan with the ritual, and not another day's", async () => {
    stubPlan();
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    expect(await screen.findByRole("list", { name: "Plan the day" })).toBeTruthy();
    cleanup();
    render(<PlanPane day={day({ plan: [], date: "2026-09-24" })} today={TODAY} onRefresh={vi.fn()} />);
    expect(await screen.findByText(/Nothing planned\. Add a task below, or press p on any task/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull();
  });

  it("keeps the ritual up once a step has run, though the plan has gained a task", async () => {
    stubPlan();
    const { rerender } = render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    await screen.findByRole("list", { name: "Plan the day" });
    fireEvent.click(screen.getByRole("button", { name: "Carry over" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Plan the day" })).getAllByRole("listitem")[1].getAttribute("aria-current")).toBe("step"));
    // The carry-over landed and the day reloaded with it: the ritual is mid-walk, so it stays.
    rerender(<PlanPane day={day({ plan: [planned] })} today={TODAY} onRefresh={vi.fn()} />);
    const steps = within(screen.getByRole("list", { name: "Plan the day" })).getAllByRole("listitem");
    expect(steps[1].getAttribute("aria-current")).toBe("step");
  });

  it("stands aside for the day when the plan filled itself before the ritual began", async () => {
    stubPlan();
    const { rerender } = render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    await screen.findByRole("list", { name: "Plan the day" });
    rerender(<PlanPane day={day({ plan: [planned] })} today={TODAY} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull());
    expect(localStorage.getItem("sb:ritual-done:" + TODAY)).toBe("1");
  });

  it("does not bring the ritual back once it was done today", async () => {
    stubPlan();
    localStorage.setItem("sb:ritual-done:" + TODAY, "1");
    render(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull());
  });

  it("moves the keyboard onto the row that takes the place of the one p unplanned", async () => {
    const posts = stubPlan();
    const two = [{ ...a, planId: 1 }, { ...b, planId: 2 }];
    const { rerender } = render(<PlanPane day={day({ plan: two })} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: a.title }), { key: "p" });
    await waitFor(() => expect(posts).toEqual([{ url: "/api/plan", method: "DELETE", body: { date: TODAY, taskId: a.id } }]));

    // The day comes back without it: the neighbour noted before the request takes the focus.
    rerender(<PlanPane day={day({ plan: [{ ...b, planId: 2 }] })} today={TODAY} onRefresh={vi.fn()} />);
    expect(document.activeElement?.textContent).toBe(b.title);
  });

  it("falls back to the pane's own heading when p empties the plan", async () => {
    const posts = stubPlan();
    const { rerender } = render(<PlanPane day={day({ plan: [{ ...a, planId: 1 }] })} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: a.title }), { key: "p" });
    await waitFor(() => expect(posts).toHaveLength(1));
    rerender(<PlanPane day={day({ plan: [] })} today={TODAY} onRefresh={vi.fn()} />);
    expect(document.activeElement?.textContent).toBe("Plan");
  });

  it("keeps the p it handled from reaching the window's own chords", () => {
    stubPlan();
    const seen: string[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener("keydown", onKey);
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.keyDown(screen.getByRole("button", { name: planned.title }), { key: "p" });
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("sends a plan row dropped on the list's own area to the end", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...a, planId: 1 }, { ...b, planId: 2 }] })} today={TODAY} onRefresh={vi.fn()} />);
    const dt = { types: ["application/x-sb-plan"], getData: () => String(a.id), setData: vi.fn(), effectAllowed: "move", dropEffect: "move" };
    fireEvent.drop(screen.getByRole("list", { name: "Plan" }), { dataTransfer: dt });
    await waitFor(() => expect(posts).toEqual([{ url: "/api/plan", method: "PATCH", body: { date: TODAY, taskIds: [b.id, a.id] } }]));
  });

  it("blocks a planned task at the next five minutes, and only on the day in hand", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T10:34:00`));
    try {
      const posts = stubPlan();
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Block now" }));
      await waitFor(() => expect(posts).toEqual([{ url: `/api/tasks/${planned.id}`, method: "PATCH", body: { scheduledAt: `${TODAY}T10:35:00` } }]));

      // Another day has no "now" on it: the item is not offered at all.
      cleanup();
      render(<PlanPane day={day({ date: "2026-09-24" })} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      expect(screen.queryByRole("menuitem", { name: "Block now" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a blocked row off the timeline without taking it off the plan", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...planned, scheduledAt: `${TODAY}T10:30:00` }] })} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Take off the timeline" }));
    await waitFor(() => expect(posts).toEqual([{ url: `/api/tasks/${planned.id}`, method: "PATCH", body: { scheduledAt: null } }]));
  });

  it("sorts the plan by its blocks from the pane's own menu", async () => {
    const posts = stubPlan();
    const onRefresh = vi.fn();
    render(<PlanPane day={day()} today={TODAY} onRefresh={onRefresh} />);
    const trigger = screen.getByRole("button", { name: "Plan actions" });
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("menu", { name: "Plan actions" })).getByRole("menuitem", { name: "Sort by time" }));
    await waitFor(() => expect(posts).toEqual([{ url: "/api/plan/sort", method: "POST", body: { date: TODAY } }]));
    // The route only reorders: the pane hears its own announcement and reads the day back.
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("closes the pane menu on Escape and hands the keyboard back to its button", () => {
    stubPlan();
    render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Plan actions" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Plan actions" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Plan actions" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("shows no ritual when the morning has nothing to offer", async () => {
    stubPlan();
    const quiet = day({ plan: [], unfinishedYesterday: [], sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] } });
    render(<PlanPane day={quiet} today={TODAY} onRefresh={vi.fn()} />);
    expect(await screen.findByText(/Nothing planned\./)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Plan the day" })).toBeNull();
  });
});
