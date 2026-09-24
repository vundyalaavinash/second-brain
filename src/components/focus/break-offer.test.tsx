// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { BreakOffer } from "./break-offer";
import type { FocusCompletedDetail } from "./use-focus";
import type { FocusRunDTO, FocusSettingsDTO } from "@/lib/dto";

const SETTINGS: FocusSettingsDTO = { defaultMinutes: 25, shortBreak: 7, longBreak: 21, longBreakEvery: 4 };

function run(over: Partial<FocusRunDTO> = {}): FocusRunDTO {
  return {
    id: 1,
    taskId: 9,
    taskTitle: "Draft the brief",
    blockId: null,
    startedAt: "2026-09-25T10:00:00.000Z",
    endedAt: "2026-09-25T10:25:00.000Z",
    plannedMinutes: 25,
    actualMinutes: 25,
    outcome: "completed",
    ...over,
  };
}

function complete(over: Partial<FocusCompletedDetail> = {}) {
  const detail: FocusCompletedDetail = { run: run(), completedToday: 1, settings: SETTINGS, where: [], ...over };
  act(() => {
    window.dispatchEvent(new CustomEvent<FocusCompletedDetail>("sb:focus-completed", { detail }));
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("BreakOffer", () => {
  it("renders nothing before any completion, and only ever a paragraph — no dialog, no backdrop", async () => {
    const { container } = render(<BreakOffer />);
    expect(container.textContent).toBe("");

    complete();
    const line = await screen.findByText(/Take \d+ minutes\?/);
    const p = line.closest("p")!;
    expect(p.tagName).toBe("P");
    expect(p.getAttribute("role")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers the saved short break normally", async () => {
    render(<BreakOffer />);
    complete({ completedToday: 2 });
    expect(await screen.findByText("Take 7 minutes?")).toBeTruthy();
  });

  it("offers the saved long break on a multiple of longBreakEvery", async () => {
    render(<BreakOffer />);
    complete({ completedToday: 4 });
    expect(await screen.findByText("Take 21 minutes?")).toBeTruthy();
  });

  it("taking the break counts down and clears itself at zero", async () => {
    vi.useFakeTimers();
    render(<BreakOffer />);
    complete({ completedToday: 1 });
    // `complete` dispatches inside its own `act`, so the button is already in the tree; fake
    // timers make `findBy*`'s own polling unreliable, so a plain `getBy*` is used instead, the
    // same way `recording-chip.test.tsx` does.
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));

    expect(screen.getByText("7:00")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(screen.getByText("6:57")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000);
    });
    expect(screen.queryByText(/Back to it in/)).toBeNull();
    expect(screen.queryByText(/Take \d+ minutes\?/)).toBeNull();
  });

  // F4: design §4.5 — the machine's own record of where the time went, said once, at the moment
  // it is most useful: right when the run's break is offered.
  it("says where the time went, once, beside the break offer", async () => {
    render(<BreakOffer />);
    complete({
      run: run({ actualMinutes: 48 }),
      where: [
        { label: "Code", ms: 39 * 60_000 },
        { label: "github.com", ms: 6 * 60_000 },
      ],
    });
    expect(await screen.findByText("48m focused — 39m on Code, 6m on github.com")).toBeTruthy();
  });

  it("says nothing about where the time went when the helper never reported, or reported nothing for the run", async () => {
    render(<BreakOffer />);
    complete({ where: [] });
    await screen.findByText(/Take \d+ minutes\?/);
    expect(screen.queryByText(/focused —/)).toBeNull();
  });

  it("dismissing the offer removes the line without starting a break", async () => {
    render(<BreakOffer />);
    complete();
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss the break offer" }));
    await waitFor(() => expect(screen.queryByText(/Take \d+ minutes\?/)).toBeNull());
  });

  it("skipping a running break removes the line", async () => {
    vi.useFakeTimers();
    render(<BreakOffer />);
    complete();
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByText(/Back to it in/)).toBeNull();
  });

  it("a second completion while a break is running replaces the offer", async () => {
    vi.useFakeTimers();
    render(<BreakOffer />);
    complete({ completedToday: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    expect(screen.getByText(/Back to it in/)).toBeTruthy();

    complete({ completedToday: 4 });

    // Back to the offer line, not mid-countdown, and the new run's break length applies.
    expect(screen.queryByText(/Back to it in/)).toBeNull();
    expect(screen.getByText("Take 21 minutes?")).toBeTruthy();
  });
});
