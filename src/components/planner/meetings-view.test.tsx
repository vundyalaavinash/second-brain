// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MeetingsView } from "./meetings-view";
import type { MeetingListDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }), usePathname: () => "/planner/meetings" }));

const TODAY = "2026-09-22";

function meeting(over: Partial<MeetingListDTO> & { id: number; title: string; startsAt: string; endsAt: string }): MeetingListDTO {
  return {
    attendees: 3,
    hasCallLink: false,
    interview: false,
    scheduledMs: 1800000,
    actualMs: 0,
    itemId: null,
    organizer: "Ada Lovelace",
    attendeeNames: [],
    location: "",
    joinUrl: null,
    allDay: false,
    status: "accepted",
    calendarTitle: "Work",
    noRecord: false,
    ...over,
  };
}

const MEETINGS: MeetingListDTO[] = [
  meeting({ id: 1, title: "Standup", startsAt: `${TODAY}T09:30:00`, endsAt: `${TODAY}T09:45:00` }),
  meeting({
    id: 2,
    title: "Product sync",
    startsAt: "2026-09-23T10:30:00",
    endsAt: "2026-09-23T11:00:00",
    joinUrl: "https://meet.example.com/sync",
    hasCallLink: true,
    itemId: 7,
    item: { id: 7, hasNotes: true, hasTranscript: true, hasSummary: false },
  }),
  meeting({ id: 3, title: "Retro", startsAt: "2026-09-15T15:00:00", endsAt: "2026-09-15T16:00:00" }),
];

function mount() {
  render(<MeetingsView today={TODAY} meetings={MEETINGS} />);
}

/** By test id, not by role: the past group's rows sit inside a closed `details`. */
function titles(): string[] {
  return screen.getAllByTestId("meeting-title").map((el) => el.textContent ?? "");
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("MeetingsView", () => {
  it("groups today, the days ahead, and the past behind a disclosure", () => {
    mount();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Wednesday 23 September")).toBeTruthy();
    const past = screen.getByText("Past 30 days").closest("details") as HTMLDetailsElement;
    expect(past.open).toBe(false);
    expect(within(past).getByText("Retro")).toBeTruthy();
  });

  it("filters the rows as the search is typed", () => {
    mount();
    expect(titles()).toEqual(["Standup", "Product sync", "Retro"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search meetings" }), { target: { value: "sync" } });
    expect(titles()).toEqual(["Product sync"]);
  });

  it("badges a meeting that has a transcript", () => {
    mount();
    const row = screen.getByText("Product sync").closest("li") as HTMLElement;
    expect(within(row).getByText("Transcript")).toBeTruthy();
    expect(within(row).queryByText("Summary")).toBeNull();
  });

  it("opens the call in a new tab without opening the meeting", () => {
    mount();
    const join = screen.getByRole("link", { name: "Join Product sync" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/sync");
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toContain("noreferrer");
    fireEvent.click(join);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("keeps a row's record button out of reach until recording arrives", () => {
    mount();
    const row = screen.getByText("Standup").closest("li") as HTMLElement;
    const record = within(row).getByRole("button", { name: "Record Standup" });
    expect(record.hasAttribute("disabled")).toBe(true);
    expect(record.getAttribute("title")).toBe("Recording arrives in the next update");
  });

  it("keeps the header's record button out of reach too", () => {
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    expect(record.hasAttribute("disabled")).toBe(true);
    expect(record.closest("[title]")?.getAttribute("title")).toBe("Recording arrives in the next update");
  });
});
