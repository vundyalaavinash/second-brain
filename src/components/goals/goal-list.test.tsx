// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GoalList } from "./goal-list";
import type { GoalDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }) }));

const TODAY = "2026-09-24";

const goal = (over: Partial<GoalDTO> = {}): GoalDTO => ({
  id: 1, title: "Launch v2", outcome: "Customers are on the new API", horizon: "quarter",
  targetDate: "2026-12-31", status: "active", notes: "", sortOrder: 0, closedAt: null,
  measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: "2026-09-23T10:00:00.000Z", stalled: false },
  containers: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...over,
});

type FetchCall = [string, RequestInit | undefined];

function stubGoals(all: () => GoalDTO[]) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/goals") return Response.json({ goals: all() });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const goalsCalls = (fetchMock: ReturnType<typeof stubGoals>) =>
  (fetchMock.mock.calls as unknown as FetchCall[]).filter(([input]) => String(input) === "/api/goals");
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("GoalList", () => {
  it("lists active goals and counts what is closed behind a disclosure", () => {
    render(<GoalList active={[goal()]} closed={[goal({ id: 2, status: "hit", title: "Shipped v1" })]} today={TODAY} />);
    expect(screen.getByRole("link", { name: /Launch v2/ })).toBeTruthy();
    expect(screen.getByText("Closed (1)").closest("details")?.hasAttribute("open")).toBe(false);
    expect(screen.getByRole("link", { name: /Shipped v1/ })).toBeTruthy();
  });

  it("says so when there are no active goals", () => {
    render(<GoalList active={[]} closed={[]} today={TODAY} />);
    expect(screen.getByText(/no active goals/i)).toBeTruthy();
  });

  it("reads the list back once when a change lands, debounced", async () => {
    const fetchMock = stubGoals(() => [goal(), goal({ id: 2 })]);
    render(<GoalList active={[goal()]} closed={[]} today={TODAY} />);
    fireEvent(window, new Event("sb:goals-changed"));
    fireEvent(window, new Event("sb:goals-changed"));

    await waitFor(() => expect(goalsCalls(fetchMock)).toHaveLength(1));
    await settle(80);
    expect(goalsCalls(fetchMock)).toHaveLength(1);
    await waitFor(() => expect(screen.getAllByRole("link", { name: /Launch v2/ })).toHaveLength(2));
  });

  it("opens the new goal form and goes to the goal once it saves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/goals" && init?.method === "POST") return Response.json(goal({ id: 9, title: "New one" }), { status: 201 });
        return new Response(null, { status: 404 });
      }),
    );
    render(<GoalList active={[]} closed={[]} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "New goal" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "New one" } });
    fireEvent.change(screen.getByLabelText("Target date"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/goals/9"));
  });
});
