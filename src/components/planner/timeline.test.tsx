// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Timeline } from "./timeline";
import type { MeetingListDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner" }));

const DATE = "2026-09-22";

const sync: MeetingListDTO = {
  id: 3,
  title: "Product sync",
  startsAt: `${DATE}T10:00:00`,
  endsAt: `${DATE}T11:00:00`,
  attendees: 3,
  hasCallLink: true,
  interview: false,
  scheduledMs: 3_600_000,
  actualMs: 0,
  itemId: 7,
  organizer: "Ada Lovelace",
  attendeeNames: [],
  location: "",
  joinUrl: "https://meet.example.com/sync",
  allDay: false,
  status: "accepted",
  calendarTitle: "Work",
  noRecord: false,
  item: { id: 7, hasNotes: true, hasTranscript: false, hasSummary: true },
};

/** The now line is the only violet rule on the column. */
const nowLine = (root: HTMLElement) => root.querySelector(".border-violet");

afterEach(() => {
  cleanup();
  nav.push.mockClear();
});

describe("Timeline", () => {
  it("names a block by its title, its hours, and how many are coming", () => {
    render(<Timeline date={DATE} meetings={[sync]} />);
    expect(screen.getByRole("button", { name: "Product sync, 10:00 to 11:00, 3 attendees" })).toBeTruthy();
  });

  it("opens the call in a new tab beside the block", () => {
    render(<Timeline date={DATE} meetings={[sync]} />);
    const join = screen.getByRole("link", { name: "Join Product sync" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/sync");
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toContain("noreferrer");
  });

  it("dots the block with what its note already holds", () => {
    render(<Timeline date={DATE} meetings={[sync]} />);
    expect(screen.getByTitle("Notes")).toBeTruthy();
    expect(screen.getByTitle("Summary")).toBeTruthy();
    expect(screen.queryByTitle("Transcript")).toBeNull();
  });

  it("draws no current-time line on a day that is not today", () => {
    const { container } = render(<Timeline date="2019-01-07" meetings={[{ ...sync, startsAt: "2019-01-07T10:00:00", endsAt: "2019-01-07T11:00:00" }]} />);
    expect(nowLine(container)).toBeNull();
  });
});
