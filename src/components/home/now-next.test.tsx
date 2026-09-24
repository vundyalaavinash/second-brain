// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NowNext } from "./now-next";
import type { HomeItemDTO, PlannerDayDTO, PlanTaskDTO, RecorderStatusDTO } from "@/lib/dto";

const DATE = "2026-09-22";

const planTask = (over: Partial<PlanTaskDTO> = {}): PlanTaskDTO => ({
  id: 7, title: "Write the brief", notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: 60, sessionMinutes: null, blocks: [], completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "", planId: 1,
  ...over,
});

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: DATE,
    plan: [],
    unfinishedYesterday: [],
    meetings: [],
    calendar: { calendarsSeen: 2, permission: true },
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 60, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0, unplacedMinutes: 60 },
    ...over,
  };
}

const meetingNow: HomeItemDTO = { kind: "meeting", title: "Design review", startsAt: "2026-09-22T10:00:00", endsAt: "2026-09-22T11:00:00", meetingId: 3, joinUrl: "https://meet.example/abc" };
const sessionNow: HomeItemDTO = { kind: "session", title: "Write the brief", startsAt: "2026-09-22T10:00:00", endsAt: "2026-09-22T10:45:00", taskId: 7, blockId: 12 };

/** Answers the recorder with the state given and records every other request. */
function stub(recorder: Partial<RecorderStatusDTO> = {}, place?: { placed: number; unplacedMinutes: number }) {
  const calls: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === "/api/meetings/recorder") return Response.json({ state: "idle", missing: [], ...recorder } satisfies RecorderStatusDTO);
      if (url === "/api/plan/place") return Response.json(place ?? { placed: 2, unplacedMinutes: 0 });
      return Response.json({});
    }),
  );
  return calls;
}

/** Every toast raised while the block runs, in order. */
function watchToasts() {
  const seen: { text: string; action?: { label: string } }[] = [];
  const listen = (e: Event) => seen.push((e as CustomEvent<{ text: string; action?: { label: string } }>).detail);
  window.addEventListener("sb:toast", listen);
  return { seen, stop: () => window.removeEventListener("sb:toast", listen) };
}

function mount(props: { now?: HomeItemDTO | null; next?: HomeItemDTO[]; day?: PlannerDayDTO; today?: string } = {}) {
  render(<NowNext day={props.day ?? day()} today={props.today ?? DATE} now={props.now ?? null} next={props.next ?? []} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NowNext", () => {
  it("says nothing is on when nothing is", () => {
    stub();
    mount();
    expect(screen.getByRole("status").textContent).toContain("Nothing on right now");
  });

  it("puts the meeting in progress in the status region, with its end, Join and Record", async () => {
    stub();
    mount({ now: meetingNow });
    const region = screen.getByRole("status");
    expect(region.textContent).toContain("Design review");
    expect(region.textContent).toContain("Ends 11:00");
    expect(screen.getByRole("link", { name: "Join Design review" }).getAttribute("href")).toBe("https://meet.example/abc");
    await waitFor(() => expect((screen.getByRole("button", { name: "Record Design review" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows the recorder's trouble beside its own, as the meetings list does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/meetings/recorder") return Response.json({ state: "idle", missing: [] } satisfies RecorderStatusDTO);
        if (url === "/api/meetings/recorder/start") return Response.json({ error: "The recorder helper is not running" }, { status: 409 });
        return Response.json({});
      }),
    );
    mount({ now: meetingNow });
    const record = await screen.findByRole("button", { name: "Record Design review" });
    await waitFor(() => expect((record as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(record);
    // NowNext holds no error of its own here: the line is the recorder's.
    expect(await screen.findByText("The recorder helper is not running")).toBeTruthy();
  });

  it("shows the recorder's own state in place of the Record button while a session runs", async () => {
    stub({ state: "recording", title: "Design review" });
    mount({ now: meetingNow });
    await waitFor(() => expect(screen.getByText("Recording")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Record Design review" })).toBeNull();
  });

  it("gives the session in progress the block's checkbox, which ticks the task off", async () => {
    const calls = stub();
    mount({ now: sessionNow });
    const box = screen.getByRole("checkbox", { name: "Write the brief" }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(calls.find((c) => c.url === "/api/tasks/7")).toBeTruthy());
    const call = calls.find((c) => c.url === "/api/tasks/7")!;
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({ status: "done" });
  });

  it("lists the next two timed things with the time each starts", () => {
    stub();
    mount({
      now: sessionNow,
      next: [
        { kind: "meeting", title: "Standup", startsAt: "2026-09-22T11:30:00", endsAt: "2026-09-22T11:45:00", meetingId: 4 },
        { kind: "session", title: "Read the notes", startsAt: "2026-09-22T14:00:00", endsAt: "2026-09-22T14:25:00", taskId: 8, blockId: 13 },
      ],
    });
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["11:30Standup", "14:00Read the notes"]);
  });

  it("offers to fill the day when a planned task has an estimate and nothing is placed", async () => {
    const calls = stub({}, { placed: 2, unplacedMinutes: 0 });
    const toasts = watchToasts();
    try {
      mount({ day: day({ plan: [planTask()] }) });
      expect(screen.getByText("Nothing placed yet")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Place in free slots" }));
      await waitFor(() => expect(calls.find((c) => c.url === "/api/plan/place")).toBeTruthy());
      const call = calls.find((c) => c.url === "/api/plan/place")!;
      expect(call.method).toBe("POST");
      expect(call.body).toEqual({ date: DATE });
      await waitFor(() => expect(toasts.seen.map((t) => t.text)).toEqual(["Placed 2 sessions"]));
    } finally {
      toasts.stop();
    }
  });

  it("offers tomorrow when the day had no room for all of it", async () => {
    stub({}, { placed: 1, unplacedMinutes: 30 });
    const toasts = watchToasts();
    try {
      mount({ day: day({ plan: [planTask()] }) });
      fireEvent.click(screen.getByRole("button", { name: "Place in free slots" }));
      await waitFor(() => expect(toasts.seen).toHaveLength(1));
      expect(toasts.seen[0].text).toBe("Placed 1 session, 30m unplaced");
      expect(toasts.seen[0].action?.label).toBe("Place tomorrow");
    } finally {
      toasts.stop();
    }
  });

  it("says nothing about placing once a session has a place, or with nothing to place", () => {
    stub();
    mount({ day: day({ plan: [planTask({ blocks: [{ id: 1, taskId: 7, startsAt: `${DATE}T09:00:00`, minutes: 60 }] })] }) });
    expect(screen.queryByRole("button", { name: "Place in free slots" })).toBeNull();
    cleanup();
    mount({ day: day({ plan: [planTask({ estimateMinutes: null })] }) });
    expect(screen.queryByRole("button", { name: "Place in free slots" })).toBeNull();
  });
});
