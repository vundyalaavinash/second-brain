import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, getItem } from "@/domain/items";
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

    archiveContainer(t.db, p.id, { moveItemsTo: a.id });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
    expect(getItem(t.db, i1.id)?.archivedAt).toBeNull();
    restoreContainer(t.db, p.id);
    archiveContainer(t.db, p.id, { moveItemsTo: null });
    expect(getItem(t.db, i1.id)?.containerId).toBe(a.id);
  });

  it("deletes only empty containers", () => {
    const p = createContainer(t.db, { kind: "project", name: "P" });
    createItem(t.db, { type: "note", title: "x", containerId: p.id });
    expect(() => deleteContainer(t.db, p.id)).toThrow(/items/);
    const empty = createContainer(t.db, { kind: "project", name: "E" });
    deleteContainer(t.db, empty.id);
    expect(getContainer(t.db, empty.id)).toBeUndefined();
  });
});
