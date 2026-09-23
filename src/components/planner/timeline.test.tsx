// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { Timeline } from "./timeline";
import type { MeetingListDTO, PlanTaskDTO } from "@/lib/dto";

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

const blocked: PlanTaskDTO = {
  id: 12,
  title: "Write the note",
  notes: "",
  status: "open",
  priority: "normal",
  dueDate: null,
  containerId: null,
  sourceItemId: null,
  estimateMinutes: 45,
  scheduledAt: `${DATE}T10:30:00`,
  completedAt: null,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
  planId: 1,
};

/** Every PATCH the timeline asked for, in order; nothing here reaches the network. */
function stubPatch(): { id: number; body: unknown }[] {
  const posts: { id: number; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") posts.push({ id: Number(String(input).split("/").pop()), body: JSON.parse(String(init.body)) });
      // The blocks beside the meetings still ask what the recorder can do.
      if (String(input) === "/api/meetings/recorder") return Response.json({ state: "idle", missing: [] });
      return Response.json({});
    }),
  );
  return posts;
}

/** What DayView hands the timeline: a PATCH that answers whether it went through. */
async function patchTask(id: number, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.ok;
}

// jsdom has neither DragEvent nor PointerEvent, so testing-library builds both from plain
// Event and the coordinates fall off them. A MouseEvent in their place carries clientY, which
// is the only thing the column and the resize handle measure by.
beforeAll(() => {
  const w = window as unknown as Record<string, unknown>;
  if (!w.DragEvent) w.DragEvent = window.MouseEvent;
  if (!w.PointerEvent) w.PointerEvent = window.MouseEvent;
});

/** The strip along a block's bottom edge; it is out of the accessibility tree by design. */
const resizeHandle = (block: HTMLElement) => block.querySelector<HTMLElement>("[data-resize]")!;

/** The now line is the only violet rule on the column. */
const nowLine = (root: HTMLElement) => root.querySelector(".border-violet");

afterEach(() => {
  cleanup();
  nav.push.mockClear();
  vi.unstubAllGlobals();
});

describe("Timeline", () => {
  it("names a block by its title, its hours, and how many are coming", () => {
    render(<Timeline date={DATE} meetings={[sync]} tasks={[]} onPatchTask={patchTask} />);
    expect(screen.getByRole("button", { name: "Product sync, 10:00 to 11:00, 3 attendees" })).toBeTruthy();
  });

  it("opens the call in a new tab beside the block", () => {
    render(<Timeline date={DATE} meetings={[sync]} tasks={[]} onPatchTask={patchTask} />);
    const join = screen.getByRole("link", { name: "Join Product sync" });
    expect(join.getAttribute("href")).toBe("https://meet.example.com/sync");
    expect(join.getAttribute("target")).toBe("_blank");
    expect(join.getAttribute("rel")).toContain("noreferrer");
  });

  it("dots the block with what its note already holds", () => {
    render(<Timeline date={DATE} meetings={[sync]} tasks={[]} onPatchTask={patchTask} />);
    expect(screen.getByTitle("Notes")).toBeTruthy();
    expect(screen.getByTitle("Summary")).toBeTruthy();
    expect(screen.queryByTitle("Transcript")).toBeNull();
  });

  it("draws no current-time line on a day that is not today", () => {
    const { container } = render(
      <Timeline date="2019-01-07" meetings={[{ ...sync, startsAt: "2019-01-07T10:00:00", endsAt: "2019-01-07T11:00:00" }]} tasks={[]} onPatchTask={patchTask} />,
    );
    expect(nowLine(container)).toBeNull();
  });

  it("covers the working hours, widened only to hold a meeting outside them", () => {
    const { container, unmount } = render(<Timeline date={DATE} meetings={[]} tasks={[]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const labels = () => Array.from(container.querySelectorAll("span.font-mono")).map((el) => el.textContent).filter((t) => /^\d\d:00$/.test(t ?? ""));
    expect(labels()[0]).toBe("09:00");
    expect(labels().at(-1)).toBe("18:00");
    unmount();
    const early = { ...sync, startsAt: `${DATE}T07:30:00`, endsAt: `${DATE}T08:00:00` };
    const { container: c2 } = render(<Timeline date={DATE} meetings={[early]} tasks={[]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const first = Array.from(c2.querySelectorAll("span.font-mono")).map((el) => el.textContent).find((t) => /^\d\d:00$/.test(t ?? ""));
    expect(first).toBe("07:00");
  });

  it("draws a planned task as a block at its start, its estimate tall", () => {
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    expect(block.style.top).toBe("90px");
    expect(block.style.height).toBe("45px");
  });

  it("drops a plan row onto the timeline at the snapped slot", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const column = screen.getByTestId("timeline-column");
    Object.defineProperty(column, "getBoundingClientRect", { value: () => ({ top: 100, left: 0, width: 400, height: 540 }) });
    const dt = { types: ["application/x-sb-plan"], getData: () => "7", dropEffect: "move" };
    fireEvent.dragOver(column, { dataTransfer: dt, clientY: 100 + 93 });
    expect(screen.getByTestId("block-ghost").style.top).toBe("95px");
    fireEvent.drop(column, { dataTransfer: dt, clientY: 100 + 93 });
    await waitFor(() => expect(posts).toEqual([{ id: 7, body: { scheduledAt: `${DATE}T10:35:00` } }]));
  });

  it("moves a block with the arrows, resizes with alt, and unblocks with backspace", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    block.focus();
    fireEvent.keyDown(block, { key: "ArrowDown" });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: `${DATE}T10:45:00` } }));
    fireEvent.keyDown(block, { key: "ArrowUp", shiftKey: true });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: `${DATE}T10:25:00` } }));
    fireEvent.keyDown(block, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { estimateMinutes: 50 } }));
    fireEvent.keyDown(block, { key: "Backspace" });
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { scheduledAt: null } }));
  });

  it("runs the column to midnight for a block that crosses it", () => {
    const late = { ...blocked, scheduledAt: `${DATE}T23:50:00`, estimateMinutes: null };
    const { container } = render(<Timeline date={DATE} meetings={[]} tasks={[late]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const labels = Array.from(container.querySelectorAll("span.font-mono")).map((el) => el.textContent).filter((t) => /^\d\d:00$/.test(t ?? ""));
    expect(labels.at(-1)).toBe("00:00");
    expect(screen.getByRole("group", { name: "Write the note, 23:50 to 00:15" }).style.top).toBe("890px");
  });

  it("keeps the resize handle out of the tab order", () => {
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const handle = resizeHandle(screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" }));
    expect(handle.getAttribute("tabindex")).toBe("-1");
    expect(handle.getAttribute("aria-hidden")).toBe("true");
  });

  it("drops a cancelled resize, and a later release writes nothing", () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    fireEvent.pointerDown(resizeHandle(block), { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 220 });
    expect(block.style.height).toBe("65px");
    fireEvent.pointerCancel(window, { clientY: 220 });
    fireEvent.pointerUp(window, { clientY: 220 });
    expect(posts).toEqual([]);
  });

  it("hands the height back to the layout when a resize changes nothing", () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    fireEvent.pointerDown(resizeHandle(block), { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 220 });
    fireEvent.pointerUp(window, { clientY: 200 });
    expect(posts).toEqual([]);
    expect(block.style.height).toBe("45px");
  });

  it("brings the block a row asked for into view and hands it the keyboard", () => {
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: "Write the note, 10:30 to 11:15" });
    // jsdom lays nothing out, so the scroll is only observed, not performed.
    const into = vi.fn();
    block.scrollIntoView = into;
    window.dispatchEvent(new CustomEvent("sb:timeline-focus", { detail: { taskId: blocked.id } }));
    expect(into).toHaveBeenCalledWith({ block: "center" });
    expect(document.activeElement).toBe(block);
  });

  it("does nothing for a task with no block on the column", () => {
    render(<Timeline date={DATE} meetings={[]} tasks={[blocked]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const before = document.activeElement;
    window.dispatchEvent(new CustomEvent("sb:timeline-focus", { detail: { taskId: 999 } }));
    expect(document.activeElement).toBe(before);
  });

  it("completes a block in place and dims a done one", async () => {
    const posts = stubPatch();
    render(<Timeline date={DATE} meetings={[]} tasks={[{ ...blocked, status: "done" }]} onPatchTask={patchTask} workHours="09:00-18:00" />);
    const block = screen.getByRole("group", { name: /Write the note/ });
    expect(block.className).toMatch(/opacity-50/);
    fireEvent.click(within(block).getByRole("checkbox"));
    await waitFor(() => expect(posts.at(-1)).toEqual({ id: blocked.id, body: { status: "open" } }));
  });
});
