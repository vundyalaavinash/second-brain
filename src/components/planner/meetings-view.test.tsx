// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { MeetingsView } from "./meetings-view";
import type { MeetingListDTO, MeetingSettingsDTO, RecorderStatusDTO } from "@/lib/dto";

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

/** The status the Record buttons read, and a record of the start they post. */
function stubRecorder(status: RecorderStatusDTO) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/meetings/recorder/start" && init?.method === "POST") {
      return Response.json({ ...status, state: "recording" });
    }
    if (String(input) === "/api/meetings/recorder") return Response.json(status);
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** The settings the two switches read, kept across the PATCH the way the route keeps them. */
function stubSettings(initial: MeetingSettingsDTO) {
  let current = initial;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/settings/meetings" && init?.method === "PATCH") {
      current = { ...current, ...(JSON.parse(String(init.body)) as Partial<MeetingSettingsDTO>) };
      return Response.json(current);
    }
    if (url === "/api/settings/meetings") return Response.json(current);
    if (url === "/api/meetings/recorder") return Response.json({ state: "idle", missing: [] });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
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

  it("says it once when there is nothing to list, rather than group by empty group", () => {
    render(<MeetingsView today={TODAY} meetings={[]} />);
    expect(screen.getByText("No meetings in the next 60 days")).toBeTruthy();
    expect(screen.queryByText("No meetings today")).toBeNull();
    expect(screen.queryByText("Past 30 days")).toBeNull();
    // The search box stays, so a filter that matches nothing can still be cleared.
    expect(screen.getByRole("searchbox", { name: "Search meetings" })).toBeTruthy();
  });

  it("says a search matched nothing and keeps the box that can clear it", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search meetings" }), { target: { value: "nothing matches this" } });
    expect(screen.getByText("No meetings match that search")).toBeTruthy();
    expect(screen.queryByTestId("meeting-title")).toBeNull();
  });

  it("records a row's meeting against its calendar event", async () => {
    const fetchMock = stubRecorder({ state: "idle", missing: [] });
    mount();
    const row = screen.getByText("Standup").closest("li") as HTMLElement;
    const record = within(row).getByRole("button", { name: "Record Standup" });
    await waitFor(() => expect(record.hasAttribute("disabled")).toBe(false));

    fireEvent.click(record);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/meetings/recorder/start");
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ calendarEventId: 1 });
    });
  });

  it("starts an unplanned recording from the header", async () => {
    const fetchMock = stubRecorder({ state: "idle", missing: [] });
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    await waitFor(() => expect(record.hasAttribute("disabled")).toBe(false));

    fireEvent.click(record);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/meetings/recorder/start");
      expect(JSON.parse(String(call![1]?.body))).toEqual({ adhoc: true });
    });
  });

  it("says it is checking before the first answer, then lets go", async () => {
    stubRecorder({ state: "idle", missing: [] });
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    expect(record.hasAttribute("disabled")).toBe(true);
    expect(record.getAttribute("title")).toBe("Checking the recorder");
    await waitFor(() => expect(record.hasAttribute("disabled")).toBe(false));
    expect(record.hasAttribute("title")).toBe(false);
  });

  it("keeps record out of reach, and says why, while the recorder helper is missing", async () => {
    stubRecorder({ state: "idle", missing: ["recorder", "finalModel"] });
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    await waitFor(() => expect(record.getAttribute("title")).toBe("Recording needs the recorder helper. Run the setup script and reload"));
    expect(record.hasAttribute("disabled")).toBe(true);
  });

  it("still records when only the transcript tools are missing, and says what they are", async () => {
    // The meeting is captured to disk either way; the transcript catches up later.
    stubRecorder({ state: "idle", missing: ["whisper", "finalModel"] });
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    await waitFor(() => expect(record.getAttribute("title")).toBe("Transcription needs: whisper-cli, the final transcript model"));
    expect(record.hasAttribute("disabled")).toBe(false);
  });

  it("keeps the switches off screen until the settings answer, rather than guessing at them", async () => {
    stubSettings({ autoRecord: false, autoRecordNeedsCallLink: true });
    mount();
    expect(screen.queryByRole("switch", { name: "Record meetings automatically" })).toBeNull();

    const auto = await screen.findByRole("switch", { name: "Record meetings automatically" });
    expect(auto.getAttribute("aria-checked")).toBe("false");
    // The join-link rule only means something once meetings record themselves.
    expect(screen.queryByRole("switch", { name: "Only with a join link" })).toBeNull();
  });

  it("saves each switch as it is flipped", async () => {
    const fetchMock = stubSettings({ autoRecord: false, autoRecordNeedsCallLink: true });
    mount();
    const auto = await screen.findByRole("switch", { name: "Record meetings automatically" });

    fireEvent.click(auto);
    await waitFor(() => expect(auto.getAttribute("aria-checked")).toBe("true"));
    const patch = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/settings/meetings" && init?.method === "PATCH");
    expect(JSON.parse(String(patch![1]?.body))).toEqual({ autoRecord: true });

    const link = screen.getByRole("switch", { name: "Only with a join link" });
    expect(link.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(link);
    await waitFor(() => expect(link.getAttribute("aria-checked")).toBe("false"));
    const last = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").at(-1);
    expect(JSON.parse(String(last![1]?.body))).toEqual({ autoRecordNeedsCallLink: false });
  });

  it("keeps record out of reach while another meeting is recording", async () => {
    stubRecorder({ state: "recording", itemId: 4, title: "Retro", startedAt: new Date().toISOString(), missing: [] });
    mount();
    const record = screen.getByRole("button", { name: "Record now" });
    await waitFor(() => expect(record.getAttribute("title")).toBe("A recording is already running"));
    expect(record.hasAttribute("disabled")).toBe(true);
  });
});
