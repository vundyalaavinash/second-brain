// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { AuditView, type AuditRow } from "./audit-view";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh }),
}));

function row(over: Partial<AuditRow> & { title: string }): AuditRow {
  return {
    seriesId: `eventkit:${over.title}`,
    occurrences: 8,
    totalMinutes: 480,
    attendedCount: 8,
    lastNoteAt: null,
    hasTranscript: false,
    tasksSince: 0,
    topActivity: [],
    nextEventId: 42,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.refresh.mockClear();
});

describe("AuditView", () => {
  it("states the week's meeting share in the planner's own wording style", () => {
    render(<AuditView rows={[]} share={{ minutes: 180, workingMinutes: 2700 }} />);
    expect(screen.getByText(/3h in meetings this week, about 7% of the working week\./)).toBeTruthy();
  });

  it("shows an honest empty state rather than nothing at all", () => {
    render(<AuditView rows={[]} share={{ minutes: 0, workingMinutes: 2700 }} />);
    expect(screen.getByText(/No meetings in the last ninety days/)).toBeTruthy();
  });

  it("carries occurrence count, total hours, and attendance -- no score, no colour, no health label", () => {
    render(
      <AuditView
        rows={[row({ title: "Weekly platform sync", occurrences: 8, totalMinutes: 480, attendedCount: 6 })]}
        share={{ minutes: 0, workingMinutes: 2700 }}
      />,
    );
    expect(screen.getByText("Weekly platform sync")).toBeTruthy();
    expect(screen.getByText(/8 occurrences in the last 90 days · 8h total · 6 of 8 attended/)).toBeTruthy();
    // Nothing on the page names a score, a percentage confidence, or a health/colour label for a row.
    expect(screen.queryByText(/health/i)).toBeNull();
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("names what activity ran, or says plainly that none was recorded", () => {
    render(<AuditView rows={[row({ title: "Design review", topActivity: [{ label: "Code", ms: 600_000 }] })]} share={{ minutes: 0, workingMinutes: 1 }} />);
    expect(screen.getByText(/Time alongside it went mostly to Code \(10m\)\./)).toBeTruthy();

    cleanup();
    render(<AuditView rows={[row({ title: "Design review", topActivity: [] })]} share={{ minutes: 0, workingMinutes: 1 }} />);
    expect(screen.getByText(/No activity was recorded alongside it\./)).toBeTruthy();
  });

  it("reports whether notes or a transcript exist, and how many tasks came out of it", () => {
    render(
      <AuditView
        rows={[row({ title: "Standup", lastNoteAt: "2026-09-01T09:00:00.000Z", hasTranscript: true, tasksSince: 2 })]}
        share={{ minutes: 0, workingMinutes: 1 }}
      />,
    );
    expect(screen.getByText(/Notes were last written/)).toBeTruthy();
    expect(screen.getByText(/A transcript exists for at least one occurrence\./)).toBeTruthy();
    expect(screen.getByText(/2 tasks came out of it\./)).toBeTruthy();
  });

  it("hides the Not going control entirely when there is no next occurrence to write against", () => {
    render(<AuditView rows={[row({ title: "Ended series", nextEventId: null })]} share={{ minutes: 0, workingMinutes: 1 }} />);
    expect(screen.queryByText("Not going")).toBeNull();
  });

  it("hides the control for a one-off with no series at all", () => {
    render(<AuditView rows={[row({ title: "One-off", seriesId: null, nextEventId: null })]} share={{ minutes: 0, workingMinutes: 1 }} />);
    expect(screen.queryByText("Not going")).toBeNull();
  });

  it("asks just the next one or every time, and writes through the existing decision route", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditView rows={[row({ title: "Weekly sync", nextEventId: 42 })]} share={{ minutes: 0, workingMinutes: 1 }} />);

    fireEvent.click(screen.getByText("Not going"));
    expect(screen.getByText(/Just the next one, or every time this meeting happens\?/)).toBeTruthy();

    fireEvent.click(screen.getByText("Every time"));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/meetings/42/decision");
    expect(call).toBeTruthy();
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ decision: "not-going", scope: "series" });
  });

  it("writes an occurrence-scoped decision for 'just the next one'", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AuditView rows={[row({ title: "Weekly sync", nextEventId: 7 })]} share={{ minutes: 0, workingMinutes: 1 }} />);

    fireEvent.click(screen.getByText("Not going"));
    fireEvent.click(screen.getByText("Just the next one"));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());

    const call = fetchMock.mock.calls.find(([url]) => String(url) === "/api/meetings/7/decision");
    const init = call?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ decision: "not-going", scope: "occurrence" });
  });
});
