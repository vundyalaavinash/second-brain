// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
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
    expect(screen.getByRole("status")).toBeTruthy();

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
