// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act, waitFor } from "@testing-library/react";
import { useFocus } from "./use-focus";
import type { FocusRunDTO, FocusSettingsDTO } from "@/lib/dto";

const STARTED_AT = "2026-09-25T10:00:00.000Z";

const SETTINGS: FocusSettingsDTO = { defaultMinutes: 25, shortBreak: 5, longBreak: 15, longBreakEvery: 4 };

function run(over: Partial<FocusRunDTO> = {}): FocusRunDTO {
  return {
    id: 1,
    taskId: 9,
    taskTitle: "Draft the brief",
    blockId: null,
    startedAt: STARTED_AT,
    endedAt: null,
    plannedMinutes: 25,
    actualMinutes: null,
    outcome: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useFocus", () => {
  it("counts remainingMs down from startedAt + plannedMinutes without asking the server again", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/focus" && !init?.method) return Response.json({ run: run({ plannedMinutes: 25 }), settings: SETTINGS, completedToday: 0 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(STARTED_AT));

    const { result } = renderHook(() => useFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.run?.id).toBe(1);
    expect(result.current.remainingMs).toBe(25 * 60_000);

    const getCalls = () => fetchMock.mock.calls.filter(([u, i]) => String(u) === "/api/focus" && !(i as RequestInit | undefined)?.method).length;
    expect(getCalls()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    // Within a tick (1s) of 12s elapsed: the exact figure depends on where the 1s interval
    // landed relative to the earlier 1ms flush, which is not what this test is about.
    expect(25 * 60_000 - result.current.remainingMs).toBeGreaterThanOrEqual(11_000);
    expect(25 * 60_000 - result.current.remainingMs).toBeLessThanOrEqual(12_001);
    // The tick recomputes the countdown locally; it never asks the server again to do it.
    expect(getCalls()).toBe(1);
  });

  it("finishes the run exactly once when the countdown reaches zero, not once per tick", async () => {
    let live: FocusRunDTO | null = run({ plannedMinutes: 1 });
    let patchCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/focus" && !init?.method) return Response.json({ run: live, settings: SETTINGS, completedToday: 0 });
      if (url === "/api/focus/1" && init?.method === "PATCH") {
        patchCalls += 1;
        expect(JSON.parse(String(init.body))).toEqual({ outcome: "completed" });
        const finished: FocusRunDTO = { ...live!, endedAt: new Date().toISOString(), actualMinutes: 1, outcome: "completed" };
        live = null;
        return Response.json({ run: finished, where: [] });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(STARTED_AT));

    renderHook(() => useFocus());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // Well past the one-minute plan, one second at a time: the tick fires many times over.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(65_000);
    });

    expect(patchCalls).toBe(1);
  });

  it("a failed start leaves run null and sets error", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/focus" && !init?.method) return Response.json({ run: null, settings: SETTINGS, completedToday: 0 });
      if (url === "/api/focus" && init?.method === "POST") return Response.json({ error: "Task not found" }, { status: 404 });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFocus());
    await waitFor(() => expect(result.current.run).toBeNull());

    act(() => {
      result.current.start({ taskId: 999 });
    });

    await waitFor(() => expect(result.current.error).toBe("Task not found"));
    expect(result.current.run).toBeNull();
  });
});
