// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { TaskRow } from "./task-row";
import type { TaskDTO } from "@/lib/dto";

// See task-list.test.tsx: this vitest config has no global `afterEach`, so
// @testing-library/react's auto-cleanup never registers and a mounted row's window
// keydown/mousedown listeners would otherwise outlive this test.
afterEach(cleanup);

const task: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: 5, sourceItemId: null,
  estimateMinutes: null, scheduledAt: null, completedAt: null, sortOrder: 0, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

interface ExtraProps {
  onPlan?: () => void;
  onEstimate?: (minutes: number | null) => void;
  onPlanDate?: (date: string) => void;
  planFrom?: string;
  planLabel?: string;
  planned?: boolean;
  compact?: boolean;
}

function renderRow(extra: ExtraProps = {}, row: TaskDTO = task) {
  const handlers = {
    onToggle: vi.fn(),
    onRename: vi.fn(),
    onDue: vi.fn(),
    onPriority: vi.fn(),
    onDrop: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
  };
  render(
    <ul role="list">
      <TaskRow task={row} today="2026-09-16" {...handlers} {...extra} />
    </ul>,
  );
  return handlers;
}

/** The portalled menu panel, which lives outside the row's own DOM subtree. */
function openMenuPanel(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
  return screen.getByRole("menu");
}

function openMenu(): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Task actions" });
  fireEvent.click(trigger);
  return trigger;
}

describe("TaskRow actions menu", () => {
  it("opens on the trigger with keyboard access: menu items, initial focus, Escape, and actions", () => {
    const handlers = renderRow();
    const trigger = screen.getByRole("button", { name: "Task actions" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(["Rename", "Set due date", "Move up", "Move down", "Drop", "Delete"]);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Rename" }));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(handlers.onMove).toHaveBeenCalledWith("up");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("TaskRow planning", () => {
  it("plans for today and closes the menu", () => {
    const onPlan = vi.fn();
    renderRow({ onPlan });
    const trigger = openMenu();
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "Rename", "Set due date", "Plan for today", "Move up", "Move down", "Drop", "Delete",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan for today" }));
    expect(onPlan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("offers to take an already planned task back off the plan", () => {
    const onPlan = vi.fn();
    renderRow({ onPlan, planned: true });
    openMenu();
    expect(screen.queryByRole("menuitem", { name: "Plan for today" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from plan" }));
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  it("opens the next seven days when a date can be chosen", () => {
    const onPlanDate = vi.fn();
    renderRow({ onPlanDate });
    const trigger = openMenu();
    const planFor = screen.getByRole("menuitem", { name: "Plan for" });
    expect(planFor.getAttribute("aria-haspopup")).toBe("menu");
    expect(planFor.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(planFor);
    expect(planFor.getAttribute("aria-expanded")).toBe("true");
    const days = screen.getByRole("menu", { name: "Plan for" });
    expect(Array.from(days.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual([
      "Today 16", "Thursday 17", "Friday 18", "Saturday 19", "Sunday 20", "Monday 21", "Tuesday 22",
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Friday 18" }));
    expect(onPlanDate).toHaveBeenCalledWith("2026-09-18");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("offers the week on screen, not this one, when the days start elsewhere", () => {
    const onPlanDate = vi.fn();
    renderRow({ onPlanDate, planFrom: "2026-10-05" });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan for" }));
    const days = screen.getByRole("menu", { name: "Plan for" });
    // No "Today": today is three weeks behind the week being shown.
    expect(Array.from(days.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual([
      "Monday 5", "Tuesday 6", "Wednesday 7", "Thursday 8", "Friday 9", "Saturday 10", "Sunday 11",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Wednesday 7" }));
    expect(onPlanDate).toHaveBeenCalledWith("2026-10-07");
  });

  it("names the single plan item after the day the view is showing", () => {
    renderRow({ onPlan: vi.fn(), planLabel: "Plan for this day" });
    openMenu();
    expect(screen.getByRole("menuitem", { name: "Plan for this day" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Plan for today" })).toBeNull();
  });

  it("escape closes the day list first and leaves the menu open", () => {
    renderRow({ onPlanDate: vi.fn() });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Plan for" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Plan for" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("TaskRow compact", () => {
  it("keeps the title and the menu in a week column's width", () => {
    renderRow({ compact: true }, { ...task, dueDate: "2026-09-18" });
    const title = screen.getByRole("button", { name: "Draft email" });
    expect(title.className).toContain("line-clamp-2");
    expect(screen.getByRole("button", { name: "Task actions" })).toBeTruthy();
    // The due date moves under the title, still in mono; the priority chip is dropped.
    expect(screen.getByRole("button", { name: "Fri 18" }).className).toContain("font-mono");
    expect(screen.queryByText("High")).toBeNull();
  });
});

describe("TaskRow estimate", () => {
  it("shows the estimate, offers presets and a free field, and clears", () => {
    const onEstimate = vi.fn();
    renderRow({ onEstimate }, { ...task, estimateMinutes: 90 });
    const chip = screen.getByRole("button", { name: "Estimate 1h 30m" });
    fireEvent.click(chip);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "25m" }));
    expect(onEstimate).toHaveBeenLastCalledWith(25);
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1h 30m" }));
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    fireEvent.change(field, { target: { value: "50" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEstimate).toHaveBeenLastCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Estimate 1h 30m" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "No estimate" }));
    expect(onEstimate).toHaveBeenLastCalledWith(null);
  });

  it("leaves the estimate alone on Escape, from the field or from the chip", () => {
    const onEstimate = vi.fn();
    renderRow({ onEstimate }, { ...task, estimateMinutes: 90 });
    const chip = screen.getByRole("button", { name: "Estimate 1h 30m" });
    fireEvent.click(chip);
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    fireEvent.change(field, { target: { value: "50" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(onEstimate).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Estimate" })).toBeNull();
    expect(document.activeElement).toBe(chip);

    // Escape reaches the wrapper from the trigger too, not only from inside the panel.
    fireEvent.click(chip);
    expect(screen.getByRole("menu", { name: "Estimate" })).toBeTruthy();
    fireEvent.keyDown(chip, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Estimate" })).toBeNull();
    expect(onEstimate).not.toHaveBeenCalled();
  });

  it("says what the field will take rather than swallowing an impossible number", () => {
    const onEstimate = vi.fn();
    renderRow({ onEstimate }, { ...task, estimateMinutes: null });
    fireEvent.click(screen.getByRole("button", { name: "Estimate: none" }));
    const field = screen.getByRole("spinbutton", { name: "Minutes" });
    fireEvent.change(field, { target: { value: "900" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEstimate).not.toHaveBeenCalled();
    expect(screen.getByText("Between 5 and 480 minutes")).toBeTruthy();
    // Typing again clears the complaint, and a sane number still commits.
    fireEvent.change(field, { target: { value: "45" } });
    expect(screen.queryByText("Between 5 and 480 minutes")).toBeNull();
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onEstimate).toHaveBeenCalledWith(45);
  });

  it("reads est when there is none, and hides without a handler", () => {
    renderRow({ onEstimate: vi.fn() }, { ...task, estimateMinutes: null });
    expect(screen.getByRole("button", { name: "Estimate: none" }).textContent).toBe("est");
    cleanup();
    renderRow({}, { ...task, estimateMinutes: 30 });
    expect(screen.queryByRole("button", { name: /Estimate/ })).toBeNull();
  });
});

describe("TaskRow keyboard planning", () => {
  it("plans on p from the title, unplans when already planned, and says so", () => {
    const onPlan = vi.fn();
    const toasts: unknown[] = [];
    const listen = (e: Event) => toasts.push((e as CustomEvent).detail);
    window.addEventListener("sb:toast", listen);
    try {
      renderRow({ onPlan }, { ...task, title: "Write" });
      const title = screen.getByRole("button", { name: "Write" });
      title.focus();
      fireEvent.keyDown(title, { key: "p" });
      expect(onPlan).toHaveBeenCalledTimes(1);
      expect(toasts).toEqual([{ text: "Planned for today" }]);
      cleanup();
      renderRow({ onPlan, planned: true }, { ...task, title: "Write" });
      fireEvent.keyDown(screen.getByRole("button", { name: "Write" }), { key: "p" });
      expect(toasts[1]).toEqual({ text: "Taken off the plan" });
    } finally {
      window.removeEventListener("sb:toast", listen);
    }
  });

  it("plans for the first offered day when the day is the caller's to choose, and names it", () => {
    const onPlanDate = vi.fn();
    const toasts: unknown[] = [];
    const listen = (e: Event) => toasts.push((e as CustomEvent).detail);
    window.addEventListener("sb:toast", listen);
    try {
      renderRow({ onPlanDate, planFrom: "2026-09-25" }, { ...task, title: "Write" });
      fireEvent.keyDown(screen.getByRole("button", { name: "Write" }), { key: "p" });
      expect(onPlanDate).toHaveBeenCalledWith("2026-09-25");
      // The day is said the way the row says every other date, not as a raw ISO string.
      expect(toasts).toEqual([{ text: "Planned for Fri 25" }]);
    } finally {
      window.removeEventListener("sb:toast", listen);
    }
  });

  it("plans from the checkbox, which takes no letters of its own", () => {
    const onPlan = vi.fn();
    renderRow({ onPlan }, { ...task, title: "Write" });
    const box = screen.getByRole("checkbox", { name: "Write" });
    box.focus();
    fireEvent.keyDown(box, { key: "p" });
    expect(onPlan).toHaveBeenCalledTimes(1);
  });

  it("ignores p raised inside the portalled actions menu", () => {
    const onPlan = vi.fn();
    renderRow({ onPlan });
    const item = within(openMenuPanel()).getByRole("menuitem", { name: "Rename" });
    fireEvent.keyDown(item, { key: "p" });
    expect(onPlan).not.toHaveBeenCalled();
  });

  it("ignores p while the title is being edited", () => {
    const onPlan = vi.fn();
    renderRow({ onPlan }, { ...task, title: "Write" });
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "p" });
    expect(onPlan).not.toHaveBeenCalled();
  });
});
