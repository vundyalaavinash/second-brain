// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Segment } from "@/domain/meetings/transcript";
import { TranscriptPane } from "./transcript-pane";

afterEach(cleanup);

/** The pane with nothing happening: each test overrides only what it is about. */
const base = {
  live: [],
  segments: [] as Segment[],
  recording: false,
  finalReady: true,
  transcribing: false,
  blocked: null,
  recordTitle: null,
  onRecord: () => {},
};

/**
 * An hour of speech used to make the page an hour long: the body was already
 * `flex-1 overflow-y-auto`, but nothing above it bounded the height, so there was nothing for it
 * to scroll within.
 */
describe("a long transcript", () => {
  const many: Segment[] = Array.from({ length: 400 }, (_, i) => ({
    start: i * 6,
    end: i * 6 + 6,
    text: `Line ${i} of a meeting that ran long.`,
  }));

  function paneOf(): HTMLElement {
    return screen.getByRole("region", { name: "Transcript" });
  }

  it("has a ceiling, so the body has something to scroll inside", () => {
    render(<TranscriptPane {...base} segments={many} />);
    const cls = paneOf().className;
    expect(cls).toContain("max-h-");
    expect(cls).toContain("min-h-");
  });

  it("scrolls the transcript itself rather than the page", () => {
    render(<TranscriptPane {...base} segments={many} />);
    const body = paneOf().querySelector(".overflow-y-auto");
    expect(body).toBeTruthy();
    expect(body!.className).toContain("flex-1");
  });

  it("still renders every line -- the cap is a viewport, not a limit on the transcript", () => {
    render(<TranscriptPane {...base} segments={many} />);
    expect(screen.getByText("Line 0 of a meeting that ran long.")).toBeTruthy();
    expect(screen.getByText("Line 399 of a meeting that ran long.")).toBeTruthy();
  });
});
