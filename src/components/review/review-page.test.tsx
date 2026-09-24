// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ReviewPage } from "./review-page";
import type { ReviewDTO } from "@/lib/dto";
import type { ReviewStep } from "@/db/enums";

const WEEK = "2026-09-21";
const NEXT_WEEK = "2026-09-28";
const DAYS = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"];

function payload(over: Partial<ReviewDTO> = {}): ReviewDTO {
  return {
    week: WEEK,
    label: "Week of 21 September 2026",
    days: DAYS,
    today: WEEK,
    current: true,
    step: "clear",
    answers: {},
    clear: { inbox: 0, leftover: [] },
    back: { done: 0, dropped: 0, slipped: 0, focusMinutes: 0, focusRuns: 0, meetings: 0, projects: [] },
    goals: [],
    ahead: { week: NEXT_WEEK, due: [], deadlines: [], meetings: [] },
    savedAt: null,
    ...over,
  };
}

/** Answers `/api/inbox` (InboxProcessor's own fetch, embedded in the Clear pane) and `/api/review`
 * PATCH by merging the saved step into the answers the given payload holds — enough to prove a
 * save round-trips without a real server. Every other request is a 404 so it cannot be mistaken
 * for one that was meant to be answered. */
function stubFetch(current: ReviewDTO) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/inbox")) return Response.json({ count: 0, items: [] });
    if (url === "/api/review" && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { week: string; step: ReviewStep; value: string | Record<string, string> };
      current = { ...current, answers: { ...current.answers, [body.step]: body.value }, savedAt: "2026-09-25T12:00:00.000Z" };
      return Response.json(current);
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ReviewPage", () => {
  it("opens on the step the saved review left off at", async () => {
    stubFetch(payload());
    render(<ReviewPage initial={payload({ step: "back", answers: { clear: "Cleared the inbox out." } })} />);
    expect(screen.getByRole("button", { name: "Look back" }).getAttribute("aria-current")).toBe("step");
    // The Look back pane's own content is showing, not the Clear pane's.
    expect(screen.getByText("How did the week go")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Inbox" })).toBeNull();
  });

  it("moves forward and back without losing what was typed", async () => {
    stubFetch(payload());
    render(<ReviewPage initial={payload()} />);
    const notes = screen.getByLabelText("Anything to flag before moving on") as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: "Inbox is empty, three tasks left over." } });
    expect(notes.value).toBe("Inbox is empty, three tasks left over.");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("How did the week go")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByLabelText("Anything to flag before moving on")).toBeTruthy());
    expect((screen.getByLabelText("Anything to flag before moving on") as HTMLTextAreaElement).value).toBe("Inbox is empty, three tasks left over.");
  });

  it("names every step in the nav, and marks the answered ones", () => {
    stubFetch(payload());
    render(<ReviewPage initial={payload({ step: "back", answers: { clear: "Cleared the inbox out." } })} />);
    const nav = screen.getByRole("navigation", { name: "Review steps" });
    for (const label of ["Clear the decks", "Look back", "Goals", "Look ahead"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    // Answered but not the one open: marked done.
    const clearButton = screen.getByRole("button", { name: "Clear the decks" });
    expect(clearButton.querySelector("svg")).toBeTruthy();
    expect(clearButton.getAttribute("aria-current")).toBeNull();
    // Open but not yet answered: current, no tick.
    const backButton = screen.getByRole("button", { name: "Look back" });
    expect(backButton.getAttribute("aria-current")).toBe("step");
    expect(backButton.querySelector("svg")).toBeNull();
    // Untouched steps: neither.
    expect(nav.contains(screen.getByRole("button", { name: "Goals" }))).toBe(true);
  });

  it("says so when the week has nothing to show rather than rendering empty panes", async () => {
    stubFetch(payload());
    render(<ReviewPage initial={payload()} />);
    expect(screen.getByText("Nothing was left open this week.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Nothing was planned this week.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("No active goals to check in on.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(screen.getByText("Nothing due, booked, or planned for next week yet.")).toBeTruthy());
  });
});
