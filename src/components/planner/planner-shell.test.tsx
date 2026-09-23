// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { PlannerShell } from "./planner-shell";
import { usePlanDate } from "@/lib/plan-date";
import type { PlannerDayDTO, PlanTaskDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const CALENDAR = { calendarsSeen: 2, permission: true };

function day(calendar: PlannerDayDTO["calendar"] = CALENDAR, over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: "2026-09-22",
    plan: [],
    unfinishedYesterday: [],
    meetings: [],
    calendar,
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0 },
    ...over,
  };
}

/** The planner's own view tabs: Day, Week, Meetings. */
function viewTabs(): HTMLElement[] {
  return within(screen.getByRole("tablist", { name: "Planner views" })).getAllByRole("tab");
}

type FetchCall = [string, RequestInit | undefined];

/** A fetch that answers the routes named and turns everything else away, so the day view's
 * own requests (the recorder, most of all) cannot be mistaken for the one under test. */
function stubRoutes(routes: Record<string, () => Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [prefix, answer] of Object.entries(routes)) if (url.startsWith(prefix)) return answer();
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function callTo(fetchMock: ReturnType<typeof stubRoutes>, url: string): FetchCall | undefined {
  return (fetchMock.mock.calls as unknown as FetchCall[]).find(([input]) => String(input) === url);
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
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

const planTask = (id: number, title: string): PlanTaskDTO => ({
  id, title, notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: null, scheduledAt: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "", planId: id,
});
const dayCalls = (fetchMock: ReturnType<typeof stubRoutes>) =>
  (fetchMock.mock.calls as unknown as FetchCall[]).filter(([input]) => String(input).startsWith("/api/planner/day"));
/** How many tasks the header says are planned — the only place the loaded day shows itself. */
const plannedCount = () => screen.getByRole("status").textContent?.split(" ")[0];
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    // One panel holds whichever view is up, named for the tab that asked for it.
    const panel = screen.getByRole("tabpanel", { name: "Day" });
    expect(panel.getAttribute("aria-labelledby")).toBe(viewTabs()[0].id);
    for (const tab of viewTabs()) expect(tab.getAttribute("aria-controls")).toBe(panel.id);
  });

  it("says the hours are the day's own and hands a new pair to the settings route", async () => {
    const fetchMock = stubRoutes({ "/api/settings/planner": () => Response.json({ workHours: "08:00-16:00" }) });
    render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);
    expect(screen.getByRole("status").textContent).toBe("0 planned · 0m of 9h free · 0 meetings");
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "08:00-16:00" } });
    fireEvent.keyDown(field, { key: "Enter" });

    const saved = await waitFor(() => {
      const call = callTo(fetchMock, "/api/settings/planner");
      expect(call).toBeTruthy();
      return call!;
    });
    expect(saved[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(saved[1]?.body))).toEqual({ workHours: "08:00-16:00" });
    // The capacity is reckoned server-side, so the day is read back rather than patched here.
    await waitFor(() => expect(callTo(fetchMock, "/api/planner/day?date=2026-09-22")).toBeTruthy());
  });

  it("keeps the old hours and says so when the save is refused", async () => {
    const fetchMock = stubRoutes({ "/api/settings/planner": () => new Response(null, { status: 400 }) });
    const toasts: string[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent<{ text: string }>).detail.text);
    window.addEventListener("sb:toast", onToast);
    try {
      render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);
      fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
      const field = screen.getByRole("textbox", { name: "Working hours" });
      fireEvent.change(field, { target: { value: "08:00-16:00" } });
      fireEvent.keyDown(field, { key: "Enter" });

      await waitFor(() => expect(toasts).toEqual(["Could not save the hours"]));
      // Nothing was read back, so the chip still names the hours the day was built with.
      expect(screen.getByRole("button", { name: "Hours 09:00-18:00" })).toBeTruthy();
      expect(callTo(fetchMock, "/api/planner/day?date=2026-09-22")).toBeUndefined();
    } finally {
      window.removeEventListener("sb:toast", onToast);
    }
  });

  it("reads the day back once when two changes land in the same interaction", async () => {
    const fetchMock = stubRoutes({ "/api/planner/day": () => Response.json(day()) });
    render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);
    fireEvent(window, new Event("sb:plan-changed"));
    fireEvent(window, new Event("sb:tasks-changed"));

    await waitFor(() => expect(dayCalls(fetchMock)).toHaveLength(1));
    // Well past the window: nothing follows the one request the pair earned.
    await settle(120);
    expect(dayCalls(fetchMock)).toHaveLength(1);
  });

  it("keeps the newest day when an earlier request answers last", async () => {
    const bodies = [day(CALENDAR, { plan: [planTask(1, "One")] }), day(CALENDAR, { plan: [planTask(1, "One"), planTask(2, "Two")] })];
    const gates: (() => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (!String(input).startsWith("/api/planner/day")) return new Response(null, { status: 404 });
        const body = bodies[gates.length];
        await new Promise<void>((resolve) => gates.push(resolve));
        return Response.json(body);
      }),
    );
    render(<PlannerShell view="day" today="2026-09-22" initial={day()} />);

    fireEvent(window, new Event("sb:plan-changed"));
    await waitFor(() => expect(gates).toHaveLength(1));
    fireEvent(window, new Event("sb:plan-changed"));
    await waitFor(() => expect(gates).toHaveLength(2));

    // The newer day lands first; the older one, held up on the wire, arrives behind it.
    gates[1]();
    await waitFor(() => expect(plannedCount()).toBe("2"));
    gates[0]();
    await settle(20);
    expect(plannedCount()).toBe("2");
  });

  it("plans a prompt-bar task on today while the week on screen holds it, else on its first day", () => {
    render(<PlannerShell view="week" today="2026-09-22" initial={{ start: "2026-09-21", days: [] }} />);
    expect(readPlanDate()).toBe("2026-09-22");
    cleanup();
    render(<PlannerShell view="week" today="2026-09-22" initial={{ start: "2026-10-05", days: [] }} />);
    expect(readPlanDate()).toBe("2026-10-05");
  });
});
