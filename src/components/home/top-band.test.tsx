// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBand } from "./top-band";
import type { HomeDTO, PlannerDayDTO } from "@/lib/dto";

const DATE = "2026-09-22";

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: DATE,
    plan: [],
    unfinishedYesterday: [],
    meetings: [],
    calendar: { calendarsSeen: 2, permission: true },
    sources: { inbox: [], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 120, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 60, unplacedMinutes: 30 },
    ...over,
  };
}

function band(counts: HomeDTO["counts"], focus: HomeDTO["focus"] = { minutes: 0, running: null }) {
  render(<TopBand day={day()} counts={counts} focus={focus} onHours={() => {}} />);
}

/** Every figure as it reads, paired with where it leads. */
function figures(): { text: string; href: string | null }[] {
  return screen.getAllByRole("link").map((a) => ({ text: a.textContent ?? "", href: a.getAttribute("href") }));
}

afterEach(cleanup);

describe("TopBand", () => {
  it("heads the day with the Planner's numeral and weekday", () => {
    band({ planned: 3, meetings: 2, inbox: 4 });
    expect(screen.getByText("22")).toBeTruthy();
    expect(screen.getByText("Tuesday")).toBeTruthy();
  });

  it("says the capacity in the Planner's own line, with the hours chip", () => {
    band({ planned: 3, meetings: 2, inbox: 4 });
    // The figure link under the band says "3 planned" too; the free time names the capacity line.
    expect(screen.getByText(/of 9h free/).textContent).toBe("3 planned · 2h of 9h free · 1h blocked · 30m unplaced · 2 meetings");
    expect(screen.getByRole("button", { name: "Hours 09:00-18:00" })).toBeTruthy();
  });

  it("leaves the one region that speaks up to Now", () => {
    band({ planned: 3, meetings: 2, inbox: 4 });
    // Spec §5: the capacity line repeats the figure under it, so on Home it does not re-announce.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("counts the plan, the meetings and the inbox, each a link to its view", () => {
    band({ planned: 3, meetings: 2, inbox: 4 });
    expect(figures()).toEqual([
      { text: "3 planned", href: "/planner" },
      { text: "2 meetings", href: "/planner/meetings" },
      { text: "4 in the inbox", href: "/inbox" },
    ]);
  });

  it("says nothing is there rather than counting to zero", () => {
    band({ planned: 0, meetings: 0, inbox: 0 });
    expect(figures().map((f) => f.text)).toEqual(["Nothing planned", "No meetings", "Inbox clear"]);
  });

  it("counts one of a thing in the singular", () => {
    band({ planned: 1, meetings: 1, inbox: 1 });
    expect(figures().map((f) => f.text)).toEqual(["1 planned", "1 meeting", "1 in the inbox"]);
  });

  it("says nothing focused yet rather than counting to zero", () => {
    band({ planned: 3, meetings: 2, inbox: 4 });
    expect(screen.getByText("Nothing focused yet")).toBeTruthy();
  });

  it("names the day's booked minutes beside the counts, as plain text rather than a link", () => {
    band({ planned: 3, meetings: 2, inbox: 4 }, { minutes: 80, running: null });
    const line = screen.getByText("1h 20m focused");
    expect(line.tagName).toBe("LI");
    expect(screen.getAllByRole("link")).toHaveLength(3);
  });
});
