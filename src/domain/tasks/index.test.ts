import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createContainer, deleteContainer } from "@/domain/containers";
import { createItem } from "@/domain/items";
import {
  createTask, getTask, listTasks, updateTask, completeTask, reopenTask, dropTask, deleteTask, reorderTasks, projectProgress, containerProgress, TaskError,
} from "./index";

describe("tasks domain", () => {
  let t: TestDb;
  let projectId: number;
  beforeEach(() => {
    t = makeTestDb();
    projectId = createContainer(t.db, { kind: "project", name: "Launch" }).id;
  });
  afterEach(() => t.cleanup());

  it("creates in append order, validates, and lists open first", () => {
    const a = createTask(t.db, { title: "  First  ", containerId: projectId });
    const b = createTask(t.db, { title: "Second", containerId: projectId, dueDate: "2026-09-20", priority: "high" });
    expect(a.title).toBe("First");
    expect([a.sortOrder, b.sortOrder]).toEqual([0, 1]);
    expect(() => createTask(t.db, { title: "   ", containerId: projectId })).toThrow(TaskError);
    expect(() => createTask(t.db, { title: "x", containerId: 999 })).toThrow(/not found/);
    expect(() => createTask(t.db, { title: "x", dueDate: "20-1-1" })).toThrow(/YYYY-MM-DD/);
    expect(() => createTask(t.db, { title: "x", sourceItemId: 999 })).toThrow(/not found/);
    completeTask(t.db, a.id);
    expect(listTasks(t.db, { containerId: projectId, status: "all" }).map((x) => x.id)).toEqual([b.id, a.id]);
    expect(listTasks(t.db, { containerId: projectId }).map((x) => x.id)).toEqual([b.id]);
  });

  it("inbox tasks have a null container and list separately", () => {
    const inbox = createTask(t.db, { title: "Loose end" });
    createTask(t.db, { title: "Filed", containerId: projectId });
    expect(listTasks(t.db, { containerId: null }).map((x) => x.id)).toEqual([inbox.id]);
    expect(listTasks(t.db, {}).length).toBe(2);
  });

  it("lists only the tasks due by a date, undated ones included nowhere", () => {
    const late = createTask(t.db, { title: "Late", dueDate: "2026-09-20" });
    const today = createTask(t.db, { title: "Today", dueDate: "2026-09-22" });
    createTask(t.db, { title: "Next month", dueDate: "2026-10-20" });
    createTask(t.db, { title: "Someday" });
    expect(listTasks(t.db, { status: "open", dueOnOrBefore: "2026-09-22" }).map((x) => x.id).sort()).toEqual([late.id, today.id].sort());
  });

  it("complete sets and reopen clears completedAt; drop is excluded from progress", () => {
    const a = createTask(t.db, { title: "A", containerId: projectId });
    const b = createTask(t.db, { title: "B", containerId: projectId });
    const c = createTask(t.db, { title: "C", containerId: projectId });
    expect(completeTask(t.db, a.id).completedAt).not.toBeNull();
    expect(reopenTask(t.db, a.id).completedAt).toBeNull();
    completeTask(t.db, a.id);
    dropTask(t.db, c.id);
    const p = projectProgress(t.db, projectId);
    expect(p).toMatchObject({ open: 1, done: 1, total: 2, percent: 50 });
    expect(p.nextTask?.id).toBe(b.id);
    expect(projectProgress(t.db, 999)).toMatchObject({ open: 0, done: 0, total: 0, percent: 0, nextTask: null });
  });

  it("nextTask follows manual order, then earliest due date with nulls last", () => {
    const a = createTask(t.db, { title: "A", containerId: projectId, dueDate: "2026-09-30" });
    const b = createTask(t.db, { title: "B", containerId: projectId, dueDate: "2026-09-10" });
    expect(projectProgress(t.db, projectId).nextTask?.id).toBe(a.id);
    reorderTasks(t.db, projectId, [b.id, a.id]);
    expect(projectProgress(t.db, projectId).nextTask?.id).toBe(b.id);
  });

  it("reorders listed ids and keeps unlisted ones after them", () => {
    const [a, b, c, d] = ["A", "B", "C", "D"].map((title) => createTask(t.db, { title, containerId: projectId }));
    const out = reorderTasks(t.db, projectId, [c.id, a.id]);
    expect(out.map((x) => x.id)).toEqual([c.id, a.id, b.id, d.id]);
    expect(out.map((x) => x.sortOrder)).toEqual([0, 1, 2, 3]);
  });

  it("updates fields, moves between containers appending at the end, and deletes", () => {
    const other = createContainer(t.db, { kind: "area", name: "Home" }).id;
    createTask(t.db, { title: "Existing", containerId: other });
    const a = createTask(t.db, { title: "A", containerId: projectId });
    const moved = updateTask(t.db, a.id, { containerId: other, priority: "low", dueDate: null, notes: "n" });
    expect(moved).toMatchObject({ containerId: other, priority: "low", sortOrder: 1, notes: "n" });
    expect(() => updateTask(t.db, a.id, { title: "" })).toThrow(TaskError);
    expect(() => updateTask(t.db, 999, { title: "x" })).toThrow(/not found/);
    deleteTask(t.db, a.id);
    expect(getTask(t.db, a.id)).toBeUndefined();
  });

  it("computes progress for many containers in one call, blocks container deletion while its tasks are active, and clears containerId once they're dropped", () => {
    const other = createContainer(t.db, { kind: "project", name: "Other" }).id;
    createTask(t.db, { title: "A", containerId: projectId });
    const bId = createTask(t.db, { title: "B", containerId: other }).id;
    completeTask(t.db, bId);
    const m = containerProgress(t.db, [projectId, other, 999]);
    expect(m.get(projectId)).toMatchObject({ open: 1, done: 0, percent: 0 });
    expect(m.get(other)).toMatchObject({ open: 0, done: 1, percent: 100, nextTask: null });
    expect(m.get(999)).toMatchObject({ total: 0 });
    const item = createItem(t.db, { type: "note", title: "n" });
    const fromItem = createTask(t.db, { title: "From note", containerId: other, sourceItemId: item.id });

    expect(() => deleteContainer(t.db, other)).toThrow(/tasks/);

    dropTask(t.db, bId);
    dropTask(t.db, fromItem.id);
    deleteContainer(t.db, other);
    expect(getTask(t.db, fromItem.id)?.containerId).toBeNull();
    expect(getTask(t.db, bId)?.containerId).toBeNull();
  });

  it("stores, updates, clears, and bounds an estimate", () => {
    const task = createTask(t.db, { title: "Write", estimateMinutes: 25 });
    expect(task.estimateMinutes).toBe(25);
    expect(updateTask(t.db, task.id, { estimateMinutes: 90 }).estimateMinutes).toBe(90);
    expect(updateTask(t.db, task.id, { estimateMinutes: null }).estimateMinutes).toBeNull();
    expect(() => updateTask(t.db, task.id, { estimateMinutes: 3 })).toThrow(/5 and 480/);
    expect(() => createTask(t.db, { title: "x", estimateMinutes: 481 })).toThrow(/5 and 480/);
  });
});
