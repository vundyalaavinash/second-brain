// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MeetingsSection } from "./meetings-section";
import type { ContainerMeetingDTO } from "@/lib/dto";

afterEach(cleanup);

const kickoff: ContainerMeetingDTO = {
  title: "Kickoff",
  startsAt: "2026-09-20T14:00:00.000Z",
  item: { id: 40, hasNotes: true, hasTranscript: false, hasSummary: true, containerId: 7 },
};

const adhoc: ContainerMeetingDTO = {
  title: "Hallway chat",
  startsAt: null,
  item: { id: 41, hasNotes: false, hasTranscript: true, hasSummary: false, containerId: 7 },
};

describe("MeetingsSection", () => {
  it("shows the title, links to the item, and the item's own badges", () => {
    render(<MeetingsSection containerId={7} meetings={[kickoff]} />);
    const row = screen.getByRole("link", { name: "Kickoff" }).closest("li") as HTMLElement;
    expect(within(row).getByRole("link", { name: "Kickoff" }).getAttribute("href")).toBe("/items/40");
    expect(within(row).getByText("Notes")).toBeTruthy();
    expect(within(row).getByText("Summary")).toBeTruthy();
    expect(within(row).queryByText("Transcript")).toBeNull();
  });

  it("says a meeting has no calendar event behind it, rather than guessing a date", () => {
    render(<MeetingsSection containerId={7} meetings={[adhoc]} />);
    expect(screen.getByText("Not on the calendar")).toBeTruthy();
  });

  it("shows the empty state when nothing is filed here, and hides the Planner link", () => {
    render(<MeetingsSection containerId={7} meetings={[]} />);
    expect(screen.getByText("No meetings filed here yet.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "See calendar meetings in Planner" })).toBeNull();
  });

  it("links out to the same container's calendar meetings in the Planner, filtered by its id", () => {
    render(<MeetingsSection containerId={7} meetings={[kickoff]} />);
    expect(screen.getByRole("link", { name: "See calendar meetings in Planner" }).getAttribute("href")).toBe("/planner/meetings?container=7");
  });

  it("hides the Planner link when every filed meeting is ad hoc, since the Planner can't show any of them (review F2 residual)", () => {
    render(<MeetingsSection containerId={7} meetings={[adhoc]} />);
    expect(screen.queryByRole("link", { name: "See calendar meetings in Planner" })).toBeNull();
  });

  it("still offers the Planner link when at least one filed meeting has a calendar event", () => {
    render(<MeetingsSection containerId={7} meetings={[adhoc, kickoff]} />);
    expect(screen.getByRole("link", { name: "See calendar meetings in Planner" })).toBeTruthy();
  });
});
