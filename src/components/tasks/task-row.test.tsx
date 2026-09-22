// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TaskRow } from "./task-row";
import type { TaskDTO } from "@/lib/dto";

// See task-list.test.tsx: this vitest config has no global `afterEach`, so
// @testing-library/react's auto-cleanup never registers and a mounted row's window
// keydown/mousedown listeners would otherwise outlive this test.
afterEach(cleanup);

const task: TaskDTO = {
  id: 1, title: "Draft email", notes: "", status: "open", priority: "normal", dueDate: null, containerId: 5, sourceItemId: null,
  completedAt: null, sortOrder: 0, createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

interface ExtraProps {
  onPlan?: () => void;
  onPlanDate?: (date: string) => void;
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
