// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { DeleteGoalDialog } from "./delete-goal-dialog";
import { GoalForm } from "./goal-form";
import type { GoalDTO } from "@/lib/dto";

const goal = (over: Partial<GoalDTO> = {}): GoalDTO => ({
  id: 1,
  title: "Launch v2",
  outcome: "Customers are on the new API",
  horizon: "quarter",
  targetDate: "2026-12-31",
  status: "active",
  notes: "",
  sortOrder: 0,
  closedAt: null,
  measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: null, stalled: false },
  containers: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A fetch that never settles until the test lets it, so "while busy" is a state a test can sit in. */
function gatedFetch() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fn = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
    void args;
    await gate;
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, release };
}

describe("the delete dialog while the delete is in flight", () => {
  it("stops answering Escape once the request has left", async () => {
    const onClose = vi.fn();
    const { fn, release } = gatedFetch();
    render(<DeleteGoalDialog goal={goal()} onDeleted={() => {}} onClose={onClose} />);

    // Before: Escape means cancel.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));

    // After: the goal is already going. Answering Escape here would tell the person they
    // cancelled while the row disappears underneath them.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    release();
  });

  it("stops answering the backdrop once the request has left", async () => {
    const onClose = vi.fn();
    const { fn, release } = gatedFetch();
    const { container } = render(<DeleteGoalDialog goal={goal()} onDeleted={() => {}} onClose={onClose} />);
    const backdrop = container.firstElementChild!;

    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    release();
  });

  it("opens with focus on Cancel, not on the button that destroys the goal", () => {
    render(<DeleteGoalDialog goal={goal()} onDeleted={() => {}} onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /cancel/i }));
  });

  it("keeps Tab inside the panel", () => {
    render(<DeleteGoalDialog goal={goal()} onDeleted={() => {}} onClose={() => {}} />);
    const cancel = screen.getByRole("button", { name: /cancel/i });
    const del = screen.getByRole("button", { name: /^delete$/i });
    del.focus();
    // Tab off the last control wraps to the first rather than walking into the page behind,
    // which is what `aria-modal` claims and markup alone does not deliver.
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(del);
  });

  it("names the goal and what goes with it", () => {
    render(<DeleteGoalDialog goal={goal({ containers: [{ id: 9, name: "API v2", slug: "api-v2", kind: "project" }] })} onDeleted={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Launch v2/)).toBeTruthy();
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(screen.getByText(/1 link/)).toBeTruthy();
  });
});

describe("the goal form's backdrop", () => {
  it("closes a form nothing has been typed into", () => {
    const onClose = vi.fn();
    const { container } = render(<GoalForm onSaved={() => {}} onClose={onClose} />);
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not throw away typing", () => {
    const onClose = vi.fn();
    const { container } = render(<GoalForm onSaved={() => {}} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Learn Rust" } });
    fireEvent.click(container.firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("works again once the typing is undone", () => {
    const onClose = vi.fn();
    const { container } = render(<GoalForm onSaved={() => {}} onClose={onClose} />);
    const title = screen.getByLabelText(/title/i);
    fireEvent.change(title, { target: { value: "L" } });
    fireEvent.change(title, { target: { value: "" } });
    // Dirtiness is measured against where the form opened, not latched on the first keystroke.
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("measures an edit against the goal's own values, not against empty", () => {
    const onClose = vi.fn();
    const { container } = render(<GoalForm goal={goal()} onSaved={() => {}} onClose={onClose} />);
    // An untouched edit form is full of text and is still pristine.
    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Launch v3" } });
    fireEvent.click(container.firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape whatever has been typed", () => {
    const onClose = vi.fn();
    render(<GoalForm onSaved={() => {}} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Learn Rust" } });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
