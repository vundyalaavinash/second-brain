// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PlanTaskDTO } from "@/lib/dto";
import { PomodoroPane } from "./pomodoro-pane";
import { resetFocusStore } from "../focus/focus-store";

const task: PlanTaskDTO = {
  id: 4,
  planId: 41,
  title: "Write the migration",
  notes: "",
  status: "open",
  priority: "normal",
  dueDate: null,
  containerId: null,
  sourceItemId: null,
  estimateMinutes: null,
  sessionMinutes: null,
  blocks: [],
  goals: [],
  spentMinutes: 0,
  likeThisMinutes: null,
  completedAt: null,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
};

const SETTINGS = { defaultMinutes: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };

/** The one request the pane's store makes on mount, answered the way the server would. */
function stubFocus(payload: Record<string, unknown>) {
  const calls: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === "/api/focus" && (init?.method ?? "GET") === "GET") {
        return Response.json({ run: null, settings: SETTINGS, completedToday: 0, break: { endsAt: null, remainingMs: 0, minutes: 0 }, ...payload });
      }
      return Response.json({});
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  resetFocusStore();
  vi.unstubAllGlobals();
});

describe("PomodoroPane", () => {
  beforeEach(() => resetFocusStore());

  it("offers the next planned task, at the configured length", async () => {
    stubFocus({});
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByRole("button", { name: "25m on Write the migration" })).toBeTruthy();
  });

  it("says what to do instead of offering nothing when the day is unplanned", async () => {
    stubFocus({});
    render(<PomodoroPane nextTask={null} />);
    await waitFor(() => expect(screen.getByText(/Plan something for today/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: /25m on/ })).toBeNull();
  });

  /** The cycle has been configured since the feature shipped and was never once shown. */
  it("shows how far through the cycle the day is", async () => {
    stubFocus({ completedToday: 3 });
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByRole("img", { name: "3 of 4 before a long break" })).toBeTruthy();
  });

  it("reads a completed cycle as a full row, not an empty one", async () => {
    stubFocus({ completedToday: 4 });
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByRole("img", { name: "4 of 4 before a long break" })).toBeTruthy();
  });

  it("counts down the run it is given, and offers to stop it", async () => {
    stubFocus({
      run: { id: 1, taskId: 4, taskTitle: "Write the migration", startedAt: new Date(Date.now() - 60_000).toISOString(), endedAt: null, plannedMinutes: 25, actualMinutes: null, outcome: null, blockId: null },
    });
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByText("Focusing")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByText(/^2[34]:/)).toBeTruthy();
  });

  // The break is the part that used to vanish on navigation: a pane that never saw it start must
  // still show it, which is only possible because it comes from the server.
  it("shows a break it never started itself", async () => {
    stubFocus({ break: { endsAt: new Date(Date.now() + 240_000).toISOString(), remainingMs: 240_000, minutes: 5 } });
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByText("Short break")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to work" })).toBeTruthy();
  });

  it("names the long break as the long one", async () => {
    stubFocus({ break: { endsAt: new Date(Date.now() + 600_000).toISOString(), remainingMs: 600_000, minutes: 15 } });
    render(<PomodoroPane nextTask={task} />);
    expect(await screen.findByText("Long break")).toBeTruthy();
  });

  it("asks the server for a break rather than deciding the length itself", async () => {
    const calls = stubFocus({});
    render(<PomodoroPane nextTask={task} />);
    fireEvent.click(await screen.findByRole("button", { name: "Break" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/focus/break" && c.method === "POST")).toBe(true));
    // No minutes: which break this is depends on the cycle, which the server already counts.
    expect(calls.find((c) => c.url === "/api/focus/break")!.body).toEqual({});
  });

  it("ends the break through the server, so another surface sees it end too", async () => {
    const calls = stubFocus({ break: { endsAt: new Date(Date.now() + 60_000).toISOString(), remainingMs: 60_000, minutes: 5 } });
    render(<PomodoroPane nextTask={task} />);
    fireEvent.click(await screen.findByRole("button", { name: "Back to work" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/focus/break" && c.method === "DELETE")).toBe(true));
  });
});
