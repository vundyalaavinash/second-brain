// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { RecordingChip } from "./recording-chip";
import type { RecorderStatusDTO } from "@/lib/dto";

vi.mock("next/navigation", () => ({ usePathname: () => "/planner" }));

const STARTED_AT = "2026-09-22T10:00:00.000Z";
const NOW = Date.parse(STARTED_AT) + 12_000;

function status(over: Partial<RecorderStatusDTO> = {}): RecorderStatusDTO {
  return { state: "recording", itemId: 7, title: "Product sync", startedAt: STARTED_AT, systemAudio: true, missing: [], ...over };
}

/** Answers the status poll, and records every post the chip makes. */
function stubFetch(initial: RecorderStatusDTO) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") return Response.json(status({ state: "idle", itemId: undefined, title: undefined }));
    if (url === "/api/meetings/recorder") return Response.json(initial);
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RecordingChip", () => {
  it("renders nothing while nothing is recording", async () => {
    const fetchMock = stubFetch(status({ state: "idle", itemId: undefined, title: undefined, startedAt: undefined }));
    const { container } = render(<RecordingChip />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("shows the elapsed time, the meeting, and a way to stop", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetchMock = stubFetch(status());
    render(<RecordingChip />);

    expect(await screen.findByText("00:12")).toBeTruthy();
    expect(screen.getByText("00:12").className).toContain("font-mono");
    const link = screen.getByRole("link", { name: "Product sync" });
    expect(link.getAttribute("href")).toBe("/items/7");
    expect(screen.getByTestId("recording-dot")).toBeTruthy();
    // The clock sits beside the live region, not inside it: a ticking one is read out every second.
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("Product sync");
    expect(live.contains(screen.getByText("00:12"))).toBe(false);
    expect(screen.getByText("00:12").getAttribute("aria-hidden")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/meetings/recorder/stop" && init?.method === "POST")).toBe(true);
    });
  });

  it("offers to keep an auto started recording, and not otherwise", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const fetchMock = stubFetch(status({ autoStarted: true }));
    render(<RecordingChip />);

    const keep = await screen.findByRole("button", { name: "Keep recording" });
    fireEvent.click(keep);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/meetings/recorder/keep" && init?.method === "POST")).toBe(true);
    });
  });

  it("leaves the keep button out when the user started the recording", async () => {
    stubFetch(status());
    render(<RecordingChip />);
    await screen.findByText("Product sync");
    expect(screen.queryByRole("button", { name: "Keep recording" })).toBeNull();
  });

  it("tells the rest of the page when a poll finds the session over", async () => {
    // The helper can exit on its own; nothing clicked, so only the poll knows.
    let current = status();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(current)),
    );
    const announced = vi.fn();
    window.addEventListener("sb:recording-changed", announced);

    // The poll is a timer, so it is a fake one from before the chip mounts.
    vi.useFakeTimers();
    render(<RecordingChip />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("Product sync")).toBeTruthy();

    current = status({ state: "idle", itemId: undefined, title: undefined, startedAt: undefined });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });

    expect(screen.queryByText("Product sync")).toBeNull();
    expect(announced).toHaveBeenCalledTimes(1);
    window.removeEventListener("sb:recording-changed", announced);
  });

  it("finds a session the rule started on the server while the chip sat idle", async () => {
    // Nothing in the browser knows: no click, and no server tick can dispatch a page event.
    let current = status({ state: "idle", itemId: undefined, title: undefined, startedAt: undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(current)),
    );
    const announced = vi.fn();
    window.addEventListener("sb:recording-changed", announced);

    vi.useFakeTimers();
    const { container } = render(<RecordingChip />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.textContent).toBe("");

    current = status();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_100);
    });

    expect(screen.getByText("Product sync")).toBeTruthy();
    expect(announced).toHaveBeenCalledTimes(1);
    window.removeEventListener("sb:recording-changed", announced);
  });

  it("shows a failed session with the message, and clears it on stop", async () => {
    const fetchMock = stubFetch(status({ state: "error", error: "recorder exited with 1", startedAt: undefined }));
    render(<RecordingChip />);
    expect(await screen.findByText("recorder exited with 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss recording error" }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/meetings/recorder/stop" && init?.method === "POST")).toBe(true);
    });
  });
});
