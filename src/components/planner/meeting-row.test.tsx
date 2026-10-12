// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MeetingRow } from "./meeting-row";
import type { MeetingListDTO } from "@/lib/dto";

function meeting(over: Partial<MeetingListDTO> & { id: number; title: string } = { id: 1, title: "Standup" }): MeetingListDTO {
  return {
    startsAt: "2026-09-22T09:30:00",
    endsAt: "2026-09-22T09:45:00",
    attendees: 3,
    hasCallLink: false,
    interview: false,
    scheduledMs: 900000,
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
    seriesId: null,
    decision: "going",
    decisionNote: "",
    seriesDecision: null,
    containerId: null,
    containerFromSeries: false,
    ...over,
  };
}

/** `containerName` is the row's own prop, not part of the meeting payload, so it rides along here
 *  rather than being invented inside `meeting()`. */
function mount(
  over: Partial<MeetingListDTO> & { id: number; title: string; containerName?: string | null } = { id: 1, title: "Standup" },
) {
  const handlers = {
    onOpen: vi.fn(),
    onNoRecord: vi.fn(),
    onRecord: vi.fn(),
    onDecision: vi.fn(),
    onContainer: vi.fn(),
    onOpenCalendar: vi.fn(),
  };
  render(
    <ul>
      <MeetingRow meeting={meeting(over)} onOpen={handlers.onOpen} onNoRecord={handlers.onNoRecord} onRecord={handlers.onRecord} onDecision={handlers.onDecision} onContainer={handlers.onContainer} containerName={over.containerName ?? null} onOpenCalendar={handlers.onOpenCalendar} blocked={null} recordTitle={null} />
    </ul>,
  );
  return handlers;
}

afterEach(() => cleanup());

describe("MeetingRow decision control", () => {
  it("shows the effective decision as the active choice", () => {
    mount({ id: 1, title: "Standup", decision: "maybe" });
    const group = screen.getByRole("group", { name: "Decision for Standup" });
    expect(within(group).getByRole("button", { name: "Maybe" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(group).getByRole("button", { name: "Going" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("writes going directly with no question, even on a recurring meeting", () => {
    const { onDecision } = mount({ id: 1, title: "Standup", decision: "not-going", seriesId: "eventkit:series-1" });
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(onDecision).toHaveBeenCalledWith("going", "occurrence");
  });

  // F2: the ordinary case above (no active series decision) must keep writing directly with no
  // question. But a series that currently has an active decision -- something to actually
  // reverse -- must ask the same scope question "Going" asks for maybe/not-going, or a declined
  // series could only ever be un-declined one future occurrence at a time, forever.
  it("asks the scope question before writing going, when the series has an active decision to reverse", () => {
    const { onDecision } = mount({
      id: 1,
      title: "Standup",
      decision: "not-going",
      seriesId: "eventkit:series-1",
      seriesDecision: "not-going",
    });
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(onDecision).not.toHaveBeenCalled();
    expect(screen.getByText("Just this one, or every time this meeting happens?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Every time" }));
    expect(onDecision).toHaveBeenCalledWith("going", "series");
  });

  it("writes a one-off meeting's decision directly, with no question", () => {
    const { onDecision } = mount({ id: 1, title: "Standup", seriesId: null });
    fireEvent.click(screen.getByRole("button", { name: "Not going" }));
    expect(onDecision).toHaveBeenCalledWith("not-going", "occurrence");
  });

  it("asks just this one or every time before writing not-going on a recurring meeting", () => {
    const { onDecision } = mount({ id: 1, title: "Standup", seriesId: "eventkit:series-1" });
    fireEvent.click(screen.getByRole("button", { name: "Not going" }));
    expect(onDecision).not.toHaveBeenCalled();
    expect(screen.getByText("Just this one, or every time this meeting happens?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Every time" }));
    expect(onDecision).toHaveBeenCalledWith("not-going", "series");
  });

  it("asks the same question before writing maybe on a recurring meeting", () => {
    const { onDecision } = mount({ id: 1, title: "Standup", seriesId: "eventkit:series-1" });
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    fireEvent.click(screen.getByRole("button", { name: "Just this one" }));
    expect(onDecision).toHaveBeenCalledWith("maybe", "occurrence");
  });

  it("says this is a record, not a reply, once a meeting is not going, with a way to open Calendar", () => {
    const { onOpenCalendar } = mount({ id: 1, title: "Standup", decision: "not-going" });
    expect(screen.getByText("This is your record, not a reply.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open in Calendar to tell the organiser" }));
    expect(onOpenCalendar).toHaveBeenCalled();
  });

  it("says nothing about Calendar for a meeting that is going or maybe", () => {
    mount({ id: 1, title: "Standup", decision: "going" });
    expect(screen.queryByText("This is your record, not a reply.")).toBeNull();
  });

  it("never hides a not-going meeting from the row -- it still shows the title and controls", () => {
    mount({ id: 1, title: "Standup", decision: "not-going" });
    expect(screen.getByTestId("meeting-title").textContent).toBe("Standup");
    expect(screen.getByRole("button", { name: "Record Standup" })).toBeTruthy();
  });
});

/**
 * Attribution: what the meeting counts against. The domain and the route have existed, and been
 * tested, since the attribution work -- with nothing in the app wired to them, so a meeting could
 * not actually be attributed to anything.
 */
describe("attributing a meeting", () => {
  it("offers attribution on a meeting that has none", () => {
    mount({ id: 1, title: "Standup" });
    expect(screen.getByRole("button", { name: "Attribute Standup to a project or area" })).toBeTruthy();
  });

  it("names what it counts against once it has one", () => {
    mount({ id: 1, title: "Standup", containerId: 8, containerName: "Payments" });
    expect(screen.getByRole("button", { name: "Attributed to Payments. Change" })).toBeTruthy();
    expect(screen.getByText("Payments")).toBeTruthy();
  });

  /** The containers the picker lists, so a pick can actually be made. */
  function stubContainers() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ id: 8, kind: "project", name: "Payments", slug: "payments", description: "", status: "active", goal: "", deadline: null, standard: "", nextSteps: "" }])),
    );
  }

  async function pickPayments(rowLabel: string) {
    stubContainers();
    fireEvent.click(screen.getByRole("button", { name: rowLabel }));
    const option = await screen.findByText("Payments");
    fireEvent.click(option);
  }

  // A recurring meeting is labelled once and stays labelled, past occurrences included, which is
  // what makes keeping this up to date cheap enough to bother with.
  it("applies to the whole series when the meeting has one", async () => {
    const handlers = mount({ id: 1, title: "Standup", seriesId: "eventkit:abc" });
    await pickPayments("Attribute Standup to a project or area");
    expect(handlers.onContainer).toHaveBeenCalledWith(8, "series");
  });

  it("applies to just this one when there is no series to apply to", async () => {
    const handlers = mount({ id: 1, title: "One-off", seriesId: null });
    await pickPayments("Attribute One-off to a project or area");
    expect(handlers.onContainer).toHaveBeenCalledWith(8, "occurrence");
  });

  it("says a series attribution covers every occurrence, when it came from one", () => {
    mount({ id: 1, title: "Standup", containerId: 8, containerName: "Payments", containerFromSeries: true });
    expect(screen.getByRole("button", { name: /Attributed to Payments/ }).getAttribute("title")).toBe(
      "Counts against Payments, for every occurrence",
    );
  });
});
