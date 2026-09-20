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

function renderRow() {
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
      <TaskRow task={task} today="2026-09-16" {...handlers} />
    </ul>,
  );
  return handlers;
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
