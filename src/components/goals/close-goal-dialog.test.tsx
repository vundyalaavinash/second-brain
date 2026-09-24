// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CloseGoalDialog } from "./close-goal-dialog";
import type { GoalDTO } from "@/lib/dto";

const goal: GoalDTO = {
  id: 1, title: "Launch v2", outcome: "Customers are on the new API", horizon: "quarter",
  targetDate: "2026-12-31", status: "active", notes: "", sortOrder: 0, closedAt: null,
  measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: null, stalled: false },
  containers: [], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

function stubPatch(status: Exclude<GoalDTO["status"], "active">) {
  // The arguments are taken as a rest tuple rather than named: the test reads them back off
  // `mock.calls`, and naming parameters it never uses in the body only trips the lint.
  const fn = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    return Response.json({ ...goal, status, closedAt: "2026-09-24T10:00:00.000Z" });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CloseGoalDialog", () => {
  it("offers hit, missed and dropped", () => {
    stubPatch("hit");
    render(<CloseGoalDialog goal={goal} onDone={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /Hit —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Missed —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dropped —/ })).toBeTruthy();
  });

  it.each([
    ["Hit —", "hit"],
    ["Missed —", "missed"],
    ["Dropped —", "dropped"],
  ] as const)("reports %s as the chosen status", async (label, status) => {
    const fetchMock = stubPatch(status);
    const onDone = vi.fn();
    render(<CloseGoalDialog goal={goal} onDone={onDone} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status })));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/goals/${goal.id}`);
    expect(JSON.parse(String(init.body))).toEqual({ status });
  });

  it("is a real dialog: labelled, focus lands inside it, and Escape closes it", () => {
    stubPatch("hit");
    const onClose = vi.fn();
    render(<CloseGoalDialog goal={goal} onDone={() => {}} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: /Launch v2/ });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
