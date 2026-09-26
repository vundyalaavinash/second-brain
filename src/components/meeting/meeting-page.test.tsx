// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { ActivityMeetingDTO, ItemDTO, RecorderStatusDTO, TaskDTO } from "@/lib/dto";
import { MeetingPage } from "./meeting-page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/items/7",
}));

// The block editor is the item editor's, already covered by its own tests, and mounting
// ProseMirror here would only slow this file down.
vi.mock("../editor/rich-editor", () => ({
  RichEditor: ({ value }: { value: string }) => <div data-testid="rich-editor">{value}</div>,
}));

// @testing-library's auto-cleanup only registers when vitest globals are on, which this
// project does not enable; without this a mounted page's listeners outlive its test.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // A test that added the rail's portal target (see `withRailSlot` below) removes it too, but
  // this is the backstop -- a leftover slot must never bleed into the next test's DOM.
  document.getElementById("rail-slot")?.remove();
});

/** The rail portals into the shell's slot, so a test that wants to see rail content -- the
 * "Audio" row's size, sentence, or "Remove the audio" action -- has to supply one; without it
 * `Rail` renders nothing, which every other test in this file relies on. */
function withRailSlot(): void {
  const slot = document.createElement("div");
  slot.id = "rail-slot";
  document.body.appendChild(slot);
}

const ITEM: ItemDTO = {
  id: 7,
  type: "meeting",
  title: "Product sync",
  body: "## Notes\n",
  status: "ready",
  error: null,
  sourceUrl: null,
  filePath: null,
  mimeType: null,
  extractedText: "",
  meta: {},
  tags: [],
  journalDate: null,
  reviewWeek: null,
  containerId: null,
  container: null,
  archivedAt: null,
  pinned: false,
  people: [],
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T09:00:00.000Z",
};

const EVENT: ActivityMeetingDTO = {
  id: 3,
  title: "Product sync",
  startsAt: "2026-09-22T10:30:00",
  endsAt: "2026-09-22T11:00:00",
  attendees: 2,
  hasCallLink: true,
  interview: false,
  scheduledMs: 1_800_000,
  actualMs: 0,
  itemId: 7,
  organizer: "Ada Lovelace",
  attendeeNames: ["Ada Lovelace", "Grace Hopper"],
  location: "Room 2",
  joinUrl: "https://meet.example.com/sync",
  allDay: false,
  status: "accepted",
  calendarTitle: "Work",
  noRecord: false,
};

const IDLE: RecorderStatusDTO = { state: "idle", missing: [] };

function item(meta: Record<string, unknown>, over: Partial<ItemDTO> = {}): ItemDTO {
  return { ...ITEM, meta, ...over };
}

/** Answers everything the page asks for on mount, and records what it posted. A successful
 * `DELETE .../audio` flips what the next `/api/items/:id` refresh answers with, to
 * `itemAfterAudioRemoval` -- the same way the real route's write is only visible on a reload. */
function stubFetch(over: { task?: TaskDTO; status?: RecorderStatusDTO; audioDeleteStatus?: number; itemAfterAudioRemoval?: ItemDTO } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  let audioRemoved = false;
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE" && url.endsWith("/audio")) {
      const status = over.audioDeleteStatus ?? 200;
      if (status < 300) audioRemoved = true;
      return new Response("{}", { status });
    }
    if (init?.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith("/actions")) return Response.json({ task: over.task ?? TASK });
      return Response.json({ ...(over.status ?? IDLE), state: "recording" });
    }
    if (url === "/api/meetings/recorder") return Response.json(over.status ?? IDLE);
    if (url.startsWith("/api/items/")) return Response.json(audioRemoved && over.itemAfterAudioRemoval ? over.itemAfterAudioRemoval : ITEM);
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, posts };
}

const TASK: TaskDTO = {
  id: 21,
  title: "Write the release note",
  notes: "Ada offered",
  status: "open",
  priority: "normal",
  dueDate: null,
  containerId: null,
  sourceItemId: 7,
  estimateMinutes: null,
  sessionMinutes: null, blocks: [],
  goals: [],
  spentMinutes: 0,
  likeThisMinutes: null,
  completedAt: null,
  sortOrder: 0,
  createdAt: "2026-09-22T11:05:00.000Z",
  updatedAt: "2026-09-22T11:05:00.000Z",
};

function mount(dto: ItemDTO, over: { event?: ActivityMeetingDTO | null; tasks?: TaskDTO[]; hasKey?: boolean; recordingBytes?: number | null } = {}) {
  render(
    <MeetingPage
      item={dto}
      event={over.event === undefined ? EVENT : over.event}
      tasks={over.tasks ?? []}
      hasKey={over.hasKey ?? true}
      recordingBytes={over.recordingBytes ?? null}
    />,
  );
}

/** A recording that finished a while ago, for the audio rail row tests below. */
const DONE_RECORDING = { startedAt: "2026-09-22T10:30:00.000Z", endedAt: "2026-09-22T11:00:00.000Z", wavPath: "meetings/7.wav", state: "done", autoStarted: false };

describe("MeetingPage", () => {
  it("renders the title, the time range and the attendee chips", () => {
    stubFetch();
    mount(item({}));
    expect(screen.getByLabelText("Meeting title")).toHaveProperty("value", "Product sync");
    expect(screen.getByText("10:30–11:00")).toBeTruthy();
    expect(screen.getByText("Grace Hopper")).toBeTruthy();
    expect(screen.getByRole("link", { name: /join/i })).toBeTruthy();
  });

  it("says there is no transcript yet and offers a Record button", async () => {
    stubFetch();
    mount(item({}));
    expect(screen.getByText("No transcript yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start recording/i })).toBeTruthy();
    // Both buttons are dead until the recorder has answered, and live once it has.
    await waitFor(() => expect((screen.getByRole("button", { name: /^record$/i }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByRole("button", { name: /start recording/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows live segments and a listening pulse while recording", () => {
    stubFetch();
    mount(
      item(
        {
          recording: { startedAt: "2026-09-22T10:30:00.000Z", wavPath: "meetings/7.wav", state: "recording", autoStarted: false },
          liveTranscript: [
            { at: "2026-09-22T10:30:10.000Z", text: "Good morning everyone" },
            { at: "2026-09-22T10:30:20.000Z", text: "Let us start with the recorder" },
          ],
        },
        { status: "processing" },
      ),
    );
    expect(screen.getByText("Good morning everyone")).toBeTruthy();
    expect(screen.getByText("Let us start with the recorder")).toBeTruthy();
    expect(screen.getByText("Listening")).toBeTruthy();
    expect(screen.getByRole("button", { name: /stop recording/i })).toBeTruthy();
    // The live region carries the stable word only: the clock beside it ticks every second.
    const live = screen.getByRole("status");
    expect(live.textContent).toBe("Recording");
    expect(live.querySelector(".font-mono")).toBeNull();
  });

  it("shows final segments with mm:ss and filters them", () => {
    stubFetch();
    mount(
      item({
        recording: { startedAt: "2026-09-22T10:30:00.000Z", wavPath: "meetings/7.wav", state: "done", autoStarted: false },
        transcript: [
          { start: 0, end: 4, text: "Good morning everyone" },
          { start: 65.4, end: 70, text: "Let us start with the recorder" },
        ],
        final_transcript_ready: true,
      }),
    );
    expect(screen.getByText("00:00")).toBeTruthy();
    expect(screen.getByText("01:05")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Filter transcript"), { target: { value: "recorder" } });
    expect(screen.queryByText("Good morning everyone")).toBeNull();
    expect(screen.getByText("Let us start with the recorder")).toBeTruthy();
  });

  it("adds a proposed action as a task and marks the row accepted", async () => {
    const { posts } = stubFetch();
    mount(
      item({
        summary: {
          summary: "The team agreed to ship on Friday.",
          decisions: ["Ship on Friday"],
          proposed_actions: [
            { title: "Write the release note", notes: "Ada offered" },
            { title: "Check the model download", notes: "" },
          ],
        },
      }),
    );
    expect(screen.getByText("The team agreed to ship on Friday.")).toBeTruthy();
    expect(screen.getByText("Ship on Friday")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /add as task/i })[0]);

    await waitFor(() => expect(screen.getByText("Added")).toBeTruthy());
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/api/meetings/7/actions");
    expect(posts[0].body).toEqual({ index: 0, title: "Write the release note" });
    // The second row is still offered.
    expect(screen.getAllByRole("button", { name: /add as task/i })).toHaveLength(1);
  });

  it("keeps an already accepted action marked and points at the task's home", () => {
    stubFetch();
    mount(
      item({
        summary: { summary: "s", decisions: [], proposed_actions: [{ title: "Write the release note", notes: "" }] },
        acceptedActions: [0],
      }),
      { tasks: [TASK] },
    );
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Inbox" }).getAttribute("href")).toBe("/inbox");
  });

  it("points at Settings when there is no key and no summary", () => {
    stubFetch();
    mount(item({}), { hasKey: false });
    expect(screen.getByText("Add an Anthropic key in Settings to get summaries")).toBeTruthy();
  });

  it("keeps polling for the summary after the transcript lands while a key is set", async () => {
    vi.useFakeTimers();
    try {
      const { fn } = stubFetch();
      mount(item({ final_transcript_ready: true, transcript: [] }), { hasKey: true });
      await vi.advanceTimersByTimeAsync(3100);
      expect(fn.mock.calls.some(([u]) => String(u) === "/api/items/7")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops polling once the summary is there", async () => {
    vi.useFakeTimers();
    try {
      const { fn } = stubFetch();
      mount(item({ final_transcript_ready: true, transcript: [], summary: { summary: "s", decisions: [], proposed_actions: [] } }), { hasKey: true });
      await vi.advanceTimersByTimeAsync(6500);
      expect(fn.mock.calls.some(([u]) => String(u) === "/api/items/7")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers 'Remove the audio' for a meeting whose transcript is good, and removes it", async () => {
    withRailSlot();
    stubFetch({
      itemAfterAudioRemoval: item({ recording: DONE_RECORDING, audioReleasedAt: "2026-10-03T09:00:00.000Z" }, { extractedText: "we agreed to ship on Friday" }),
    });
    mount(item({ recording: DONE_RECORDING }, { extractedText: "we agreed to ship on Friday" }), { recordingBytes: 2048 });
    expect(screen.getByText("2 kB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove the audio" }));
    await waitFor(() => expect(screen.getByText("Removed 3 October; the transcript is kept")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Remove the audio" })).toBeNull();
  });

  it("does not offer 'Remove the audio' before there is a transcript", () => {
    withRailSlot();
    stubFetch();
    mount(item({ recording: DONE_RECORDING }), { recordingBytes: 2048 });
    expect(screen.getByText("2 kB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove the audio" })).toBeNull();
  });

  it("says the audio was removed and the transcript is kept, rather than silently offering nothing", () => {
    withRailSlot();
    stubFetch();
    mount(item({ recording: DONE_RECORDING, audioReleasedAt: "2026-10-03T09:00:00.000Z" }, { extractedText: "we agreed to ship on Friday" }));
    expect(screen.getByText("Removed 3 October; the transcript is kept")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove the audio" })).toBeNull();
  });

  it("shows an error when removing the audio fails, and the button stays put", async () => {
    withRailSlot();
    stubFetch({ audioDeleteStatus: 409 });
    mount(item({ recording: DONE_RECORDING }, { extractedText: "we agreed to ship on Friday" }), { recordingBytes: 2048 });

    fireEvent.click(screen.getByRole("button", { name: "Remove the audio" }));
    await waitFor(() => expect(screen.getByText("Could not remove the audio")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Remove the audio" })).toBeTruthy();
  });
});
