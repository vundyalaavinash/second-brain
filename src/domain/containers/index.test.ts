import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem, updateItem } from "@/domain/items";
import { createTask, dropTask, getTask, listTasks } from "@/domain/tasks";
import { eq } from "drizzle-orm";
import { tasks } from "@/db/schema";
import {
  slugify,
  createContainer,
  getContainer,
  getContainerBySlug,
  listContainers,
  updateContainer,
  archiveContainer,
  restoreContainer,
  deleteContainer,
  countContainerItems,
  ContainerError,
} from "./index";

describe("containers domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("slugifies names", () => {
    expect(slugify("  Launch v2: The Big One! ")).toBe("launch-v2-the-big-one");
    expect(slugify("Ünïcode & stuff")).toBe("unicode-stuff");
    expect(slugify("!!!")).toBe("container");
  });

  it("creates containers with unique slugs and kind defaults", () => {
    const a = createContainer(t.db, { kind: "project", name: "Launch", goal: "Ship it", deadline: "2026-10-01" });
    const b = createContainer(t.db, { kind: "area", name: "Launch" });
    expect(a.slug).toBe("launch");
    expect(b.slug).toBe("launch-2");
    expect(a.status).toBe("active");
    expect(a.goal).toBe("Ship it");
    expect(getContainer(t.db, a.id)?.deadline).toBe("2026-10-01");
    expect(getContainerBySlug(t.db, "launch-2")?.kind).toBe("area");
    const r = createContainer(t.db, { kind: "resource", name: "Baking" });
    expect(r.category).toBe("other");
  });

  it("lists by kind and status with the right ordering", () => {
    const late = createContainer(t.db, { kind: "project", name: "Late", deadline: "2026-12-01" });
    const none = createContainer(t.db, { kind: "project", name: "No deadline" });
    const soon = createContainer(t.db, { kind: "project", name: "Soon", deadline: "2026-10-01" });
    const areaB = createContainer(t.db, { kind: "area", name: "Health" });
    const areaA = createContainer(t.db, { kind: "area", name: "Finance" });
    expect(listContainers(t.db, { kind: "project" }).map((c) => c.id)).toEqual([soon.id, late.id, none.id]);
    expect(listContainers(t.db, { kind: "area" }).map((c) => c.id)).toEqual([areaA.id, areaB.id]);
    updateContainer(t.db, areaB.id, { sortOrder: -1 });
    expect(listContainers(t.db, { kind: "area" }).map((c) => c.id)).toEqual([areaB.id, areaA.id]);
    archiveContainer(t.db, late.id);
    expect(listContainers(t.db, { kind: "project", status: "active" }).map((c) => c.id)).toEqual([soon.id, none.id]);
    expect(listContainers(t.db, { status: "archived" }).map((c) => c.id)).toEqual([late.id]);
    expect(listContainers(t.db)).toHaveLength(5);
  });

  it("updates fields and rejects unknown ids", () => {
    const c = createContainer(t.db, { kind: "resource", name: "Tools" });
    const u = updateContainer(t.db, c.id, { category: "tools", description: "Handy things", name: "Tooling" });
    expect(u.category).toBe("tools");
    expect(u.name).toBe("Tooling");
    expect(u.slug).toBe("tooling"); // slugs follow the name; pages redirect on rename
    expect(() => updateContainer(t.db, 999, { name: "x" })).toThrow(ContainerError);
  });

  it("archives with its items, or re-homes them, and restores", () => {
    const p = createContainer(t.db, { kind: "project", name: "P" });
    const a = createContainer(t.db, { kind: "area", name: "A" });
    const i1 = createItem(t.db, { type: "note", title: "one", containerId: p.id });
    const i2 = createItem(t.db, { type: "note", title: "two", containerId: p.id });
    expect(countContainerItems(t.db, p.id)).toBe(2);

    const archived = archiveContainer(t.db, p.id);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBeTruthy();
    expect(getItem(t.db, i1.id)?.archivedAt).toBeTruthy();
    expect(countContainerItems(t.db, p.id)).toBe(0);
    expect(countContainerItems(t.db, p.id, true)).toBe(2);

    const restored = restoreContainer(t.db, p.id);
    expect(restored.status).toBe("active");
    expect(getItem(t.db, i2.id)?.archivedAt).toBeNull();

    // Both items are still filed in p (untouched by the archive/restore above); moving them out
    // should re-home both, not just the one the old assertion happened to check.
    expect(getItem(t.db, i1.id)?.containerId).toBe(p.id);
    expect(getItem(t.db, i2.id)?.containerId).toBe(p.id);
    archiveContainer(t.db, p.id, { moveItemsTo: a.id });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
    expect(getItem(t.db, i2.id)?.containerId).toBe(a.id);
    expect(getItem(t.db, i1.id)?.archivedAt).toBeNull();
    restoreContainer(t.db, p.id);
    archiveContainer(t.db, p.id, { moveItemsTo: null });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
  });

  it("rejects moving a container's items into itself", () => {
    const p = createContainer(t.db, { kind: "project", name: "Self" });
    expect(() => archiveContainer(t.db, p.id, { moveItemsTo: p.id })).toThrow(ContainerError);
    expect(() => archiveContainer(t.db, p.id, { moveItemsTo: p.id })).toThrow(/itself/);
  });

  it("restores only items archived alongside the container, not ones archived individually", () => {
    const p = createContainer(t.db, { kind: "project", name: "Solo" });
    const a = createItem(t.db, { type: "note", title: "individually archived", containerId: p.id });
    const b = createItem(t.db, { type: "note", title: "archived with container", containerId: p.id });
    updateItem(t.db, a.id, { archivedAt: "2026-01-01T00:00:00.000Z" });

    archiveContainer(t.db, p.id);
    restoreContainer(t.db, p.id);

    expect(getItem(t.db, b.id)?.archivedAt).toBeNull();
    expect(getItem(t.db, a.id)?.archivedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("deletes only empty containers", () => {
    const p = createContainer(t.db, { kind: "project", name: "P" });
    createItem(t.db, { type: "note", title: "x", containerId: p.id });
    expect(() => deleteContainer(t.db, p.id)).toThrow(/items/);
    const empty = createContainer(t.db, { kind: "project", name: "E" });
    deleteContainer(t.db, empty.id);
    expect(getContainer(t.db, empty.id)).toBeUndefined();
  });

  it("archiving drops open tasks, or moves them (including to the inbox) after the target's existing ones", () => {
    const home = createContainer(t.db, { kind: "area", name: "Home" });
    const p2 = createContainer(t.db, { kind: "project", name: "Second" });
    const t1 = createTask(t.db, { title: "Move me", containerId: p2.id });
    archiveContainer(t.db, p2.id, { moveItemsTo: home.id });
    expect(listTasks(t.db, { containerId: home.id }).map((x) => x.id)).toContain(t1.id);

    const p3 = createContainer(t.db, { kind: "project", name: "Third" });
    const t2 = createTask(t.db, { title: "Drop me", containerId: p3.id });
    archiveContainer(t.db, p3.id);
    expect(listTasks(t.db, { containerId: p3.id, status: "dropped" }).map((x) => x.id)).toEqual([t2.id]);
    expect(listTasks(t.db, { containerId: p3.id }).map((x) => x.id)).toEqual([]);

    const p4 = createContainer(t.db, { kind: "project", name: "Fourth" });
    const t3 = createTask(t.db, { title: "To inbox", containerId: p4.id });
    archiveContainer(t.db, p4.id, { moveItemsTo: null });
    expect(listTasks(t.db, { containerId: null }).map((x) => x.id)).toContain(t3.id);
  });

  it("restoring reopens tasks dropped alongside the container, not ones dropped by hand", () => {
    const p = createContainer(t.db, { kind: "project", name: "Solo tasks" });
    const manual = createTask(t.db, { title: "manual drop", containerId: p.id });
    dropTask(t.db, manual.id);
    // Give the manual drop a timestamp far from the archive below, the same way the items test
    // above pins one via updateItem, so this doesn't depend on the two operations landing in
    // different milliseconds.
    t.db.update(tasks).set({ updatedAt: "2026-01-01T00:00:00.000Z" }).where(eq(tasks.id, manual.id)).run();
    const auto = createTask(t.db, { title: "auto drop", containerId: p.id });

    archiveContainer(t.db, p.id);
    restoreContainer(t.db, p.id);

    expect(getTask(t.db, auto.id)?.status).toBe("open");
    expect(getTask(t.db, manual.id)?.status).toBe("dropped");
  });
});
