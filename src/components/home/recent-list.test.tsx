// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { RecentList } from "./recent-list";
import type { RecentItemDTO } from "@/lib/dto";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

const item = (over: Partial<RecentItemDTO> = {}): RecentItemDTO => ({
  id: 1,
  type: "note",
  title: "Kickoff notes",
  updatedAt: "2026-09-22T10:00:00.000Z",
  status: "ready",
  ...over,
});

afterEach(cleanup);

describe("RecentList", () => {
  it("lists what was touched last, each a link, with how long ago it was", () => {
    render(<RecentList recent={[item()]} now={NOW} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link", { name: "Kickoff notes" }).getAttribute("href")).toBe("/items/1");
    expect(within(row).getByRole("img", { name: "Note" })).toBeTruthy();
    expect(row.textContent).toContain("2 h ago");
  });

  it("says what a recorded meeting has to show for itself", () => {
    render(
      <RecentList
        now={NOW}
        recent={[
          item({ id: 2, type: "meeting", title: "Design review", meeting: { hasTranscript: true, hasSummary: true } }),
          item({ id: 3, type: "meeting", title: "Standup", meeting: { hasTranscript: true, hasSummary: false } }),
          item({ id: 4, type: "meeting", title: "Retro", meeting: { hasTranscript: false, hasSummary: false } }),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Summary")).toBeTruthy();
    expect(within(rows[1]).getByText("Transcript")).toBeTruthy();
    expect(within(rows[1]).queryByText("Summary")).toBeNull();
    expect(within(rows[2]).queryByText("Transcript")).toBeNull();
  });

  it("leaves a note without a meeting's chips", () => {
    render(<RecentList recent={[item()]} now={NOW} />);
    expect(screen.queryByText("Transcript")).toBeNull();
    expect(screen.queryByText("Summary")).toBeNull();
  });

  it("says the shelf is empty in one line", () => {
    render(<RecentList recent={[]} now={NOW} />);
    expect(screen.getByText("Nothing captured yet")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
