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
  estimateMinutes: null, sessionMinutes: null, blocks: [], completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
};
const planned: PlanTaskDTO = { ...base, id: 2, title: "Write the brief", planId: 9, sortOrder: 0 };
const a: TaskDTO = { ...base, id: 3, title: "First thing" };
const b: TaskDTO = { ...base, id: 4, title: "Second thing" };
const c: TaskDTO = { ...base, id: 5, title: "Dragged in" };

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [planned],
    unfinishedYesterday: [base],
    meetings: [],
    calendar: { calendarsSeen: 2, permission: true },
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [{ container: { id: 10, name: "Launch", slug: "launch", kind: "project" }, tasks: [c] }], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0, unplacedMinutes: 0 },
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

/** Records every request, answering a place with the figures the day is meant to report. */
function stubPlace(...answers: { placed: number; unplacedMinutes: number }[]) {
  const posts: { url: string; method?: string; body: unknown }[] = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(input) === "/api/plan/place") return Response.json(answers[Math.min(i++, answers.length - 1)]);
      return Response.json({});
    }),
  );
  return posts;
}

/** Every toast the pane raises, in order, with the action's label where it carries one. */
function watchToasts() {
  const seen: { text: string; action?: { label: string; onClick(): void } }[] = [];
  const listen = (e: Event) => seen.push((e as CustomEvent<{ text: string; action?: { label: string; onClick(): void } }>).detail);
  window.addEventListener("sb:toast", listen);
  return { seen, stop: () => window.removeEventListener("sb:toast", listen) };
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

  it("fills the capacity bar and turns it red well past the free time", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const { container } = render(
      <PlanPane day={day({ capacity: { freeMinutes: 540, plannedMinutes: 700, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0, unplacedMinutes: 0 } })} today={TODAY} onRefresh={vi.fn()} />,
    );
    const fill = container.querySelector(".bg-danger") as HTMLElement;
    expect(fill).toBeTruthy();
    // Past the free time the bar stops at full rather than running off the track.
    expect(fill.style.width).toBe("100%");
  });

  it("shows blocked time against the day's free hours, estimates or no estimates", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    // Three blocks nobody estimated: 75 minutes of a 300-minute day, and not one of them
    // counted in `plannedMinutes`, which is what the segment used to be measured against.
    const { container } = render(
      <PlanPane day={day({ capacity: { freeMinutes: 300, plannedMinutes: 0, unestimated: 3, workHours: "09:00-14:00", blockedMinutes: 75, unplacedMinutes: 0 } })} today={TODAY} onRefresh={vi.fn()} />,
    );
    const blocked = container.querySelector(".bg-violet-bright") as HTMLElement;
    expect(blocked).toBeTruthy();
    expect(blocked.style.width).toBe("25%");
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
    // A two-hour task with no session length of its own: one 45-minute session, not a slab.
    const long = day({ plan: [{ ...planned, estimateMinutes: 120 }] });
    const block = (startsAt: string) => ({ url: "/api/blocks", method: "POST", body: { taskId: planned.id, startsAt, minutes: 45 } });
    try {
      const posts = stubPlan();
      render(<PlanPane day={long} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Block now" }));
      await waitFor(() => expect(posts).toEqual([block(`${TODAY}T10:35:00`)]));

      // On the mark itself the next slot is the one after it, never the minute already going.
      cleanup();
      vi.setSystemTime(new Date(`${TODAY}T10:30:00`));
      const onTheMark = stubPlan();
      render(<PlanPane day={long} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Block now" }));
      await waitFor(() => expect(onTheMark).toEqual([block(`${TODAY}T10:35:00`)]));

      // The last slot the day holds: 23:58 blocks at 23:55 rather than rolling into tomorrow.
      cleanup();
      vi.setSystemTime(new Date(`${TODAY}T23:58:00`));
      const atMidnight = stubPlan();
      render(<PlanPane day={long} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Block now" }));
      await waitFor(() => expect(atMidnight).toEqual([block(`${TODAY}T23:55:00`)]));

      // Another day has no "now" on it: the item is not offered at all.
      cleanup();
      render(<PlanPane day={day({ date: "2026-09-24" })} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      expect(screen.queryByRole("menuitem", { name: "Block now" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a block on the pane's own day a chip that goes and looks at it", () => {
    stubPlan();
    const seen: unknown[] = [];
    const listen = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("sb:timeline-focus", listen);
    try {
      render(<PlanPane day={day({ plan: [{ ...planned, blocks: [{ id: 1, taskId: planned.id, startsAt: `${TODAY}T10:30:00`, minutes: 25 }] }] })} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Blocked at 10:30" }));
      expect(seen).toEqual([{ taskId: planned.id, blockId: 1 }]);
    } finally {
      window.removeEventListener("sb:timeline-focus", listen);
    }
  });

  it("takes a blocked row off the timeline without taking it off the plan", async () => {
    const posts = stubPlan();
    render(<PlanPane day={day({ plan: [{ ...planned, blocks: [{ id: 1, taskId: planned.id, startsAt: `${TODAY}T10:30:00`, minutes: 25 }] }] })} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Take off the timeline" }));
    // The whole day goes, and only that day: the route needs the date to know which sessions.
    await waitFor(() => expect(posts).toEqual([{ url: `/api/tasks/${planned.id}/blocks?date=${TODAY}`, method: "DELETE", body: null }]));
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

  it("fills the day from the pane's menu and says what it placed", async () => {
    const posts = stubPlace({ placed: 3, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Plan actions" }));
      fireEvent.click(within(screen.getByRole("menu", { name: "Plan actions" })).getByRole("menuitem", { name: "Fill the day" }));
      await waitFor(() => expect(posts).toEqual([{ url: "/api/plan/place", method: "POST", body: { date: TODAY } }]));
      await waitFor(() => expect(toasts.seen).toEqual([{ text: "Placed 3 sessions", action: undefined }]));
    } finally {
      toasts.stop();
    }
  });

  it("places one row's sessions from its menu and from f", async () => {
    const posts = stubPlace({ placed: 1, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Place in free slots" }));
      await waitFor(() => expect(posts).toEqual([{ url: "/api/plan/place", method: "POST", body: { date: TODAY, taskId: planned.id } }]));
      // One session is one session, not "1 sessions".
      await waitFor(() => expect(toasts.seen[0].text).toBe("Placed 1 session"));

      fireEvent.keyDown(screen.getByRole("button", { name: planned.title }), { key: "f" });
      await waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual({ url: "/api/plan/place", method: "POST", body: { date: TODAY, taskId: planned.id } });
    } finally {
      toasts.stop();
    }
  });

  it("says a day with no room for anything placed nothing", async () => {
    const posts = stubPlace({ placed: 0, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Plan actions" }));
      fireEvent.click(within(screen.getByRole("menu", { name: "Plan actions" })).getByRole("menuitem", { name: "Fill the day" }));
      await waitFor(() => expect(posts).toHaveLength(1));
      await waitFor(() => expect(toasts.seen[0].text).toBe("Nothing to place"));
      expect(toasts.seen[0].action).toBeUndefined();
    } finally {
      toasts.stop();
    }
  });

  it("offers tomorrow what today had no room for, plans the task there and places it", async () => {
    const posts = stubPlace({ placed: 3, unplacedMinutes: 80 }, { placed: 2, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Place in free slots" }));
      await waitFor(() => expect(toasts.seen[0].text).toBe("Placed 3 sessions, 1h 20m unplaced"));
      expect(toasts.seen[0].action?.label).toBe("Place tomorrow");

      act(() => toasts.seen[0].action?.onClick());
      await waitFor(() => expect(posts).toHaveLength(3));
      expect(posts.slice(1)).toEqual([
        { url: "/api/plan", method: "POST", body: { date: "2026-09-23", taskId: planned.id } },
        { url: "/api/plan/place", method: "POST", body: { date: "2026-09-23", taskId: planned.id } },
      ]);
      // Tomorrow's own toast does not offer the day after: the offer is made once.
      await waitFor(() => expect(toasts.seen).toHaveLength(2));
      expect(toasts.seen[1]).toEqual({ text: "Placed 2 sessions", action: undefined });
    } finally {
      toasts.stop();
    }
  });

  it("fills tomorrow with what it already holds, planning nothing new", async () => {
    const posts = stubPlace({ placed: 1, unplacedMinutes: 45 }, { placed: 1, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Plan actions" }));
      fireEvent.click(within(screen.getByRole("menu", { name: "Plan actions" })).getByRole("menuitem", { name: "Fill the day" }));
      await waitFor(() => expect(toasts.seen[0].action?.label).toBe("Place tomorrow"));
      act(() => toasts.seen[0].action?.onClick());
      await waitFor(() => expect(posts).toHaveLength(2));
      expect(posts[1]).toEqual({ url: "/api/plan/place", method: "POST", body: { date: "2026-09-23" } });
    } finally {
      toasts.stop();
    }
  });

  it("splits a task into sessions, and lays out again a day that already held some", async () => {
    const posts = stubPlace({ placed: 3, unplacedMinutes: 0 });
    render(<PlanPane day={day()} today={TODAY} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Split into" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "45m" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    // Nothing on the timeline yet: the length is saved and the day is left where it is.
    expect(posts[0]).toEqual({ url: `/api/tasks/${planned.id}`, method: "PATCH", body: { sessionMinutes: 45 } });

    cleanup();
    const withSessions = stubPlace({ placed: 3, unplacedMinutes: 0 });
    render(
      <PlanPane day={day({ plan: [{ ...planned, estimateMinutes: 120, blocks: [{ id: 1, taskId: planned.id, startsAt: `${TODAY}T09:00:00`, minutes: 120 }] }] })} today={TODAY} onRefresh={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Split into" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "45m" }));
    await waitFor(() => expect(withSessions).toHaveLength(2));
    expect(withSessions).toEqual([
      { url: `/api/tasks/${planned.id}`, method: "PATCH", body: { sessionMinutes: 45 } },
      { url: "/api/plan/place", method: "POST", body: { date: TODAY, taskId: planned.id } },
    ]);
  });
});
