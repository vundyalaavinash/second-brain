import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createContainer } from "./index";
import { createItem } from "@/domain/items";
import { setItemPeople } from "@/domain/people";
import { createPerson } from "@/domain/people";
import { suggestContainer, suggestContainersFor } from "./suggest";

describe("suggestContainer", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("suggests a project whose name shares a real word with the meeting title", () => {
    const project = createContainer(t.db, { kind: "project", name: "Q3 Platform Migration" });
    createContainer(t.db, { kind: "project", name: "Kestrel" });
    const suggestion = suggestContainer(t.db, { title: "Platform sync", attendeeNames: [] });
    expect(suggestion).toEqual({ id: project.id, name: project.name, slug: project.slug, kind: "project" });
  });

  it("suggests a project one of whose people matches an attendee name", () => {
    const project = createContainer(t.db, { kind: "project", name: "Random Widget Rebuild" });
    const person = createPerson(t.db, { name: "Dana Kim" });
    const item = createItem(t.db, { type: "note", title: "Kickoff notes", containerId: project.id });
    setItemPeople(t.db, item.id, [person.id]);
    const suggestion = suggestContainer(t.db, { title: "Unrelated words entirely", attendeeNames: ["Dana Kim"] });
    expect(suggestion).toEqual({ id: project.id, name: project.name, slug: project.slug, kind: "project" });
  });

  it("suggests nothing when no signal reaches the threshold, rather than guessing", () => {
    createContainer(t.db, { kind: "project", name: "Kestrel" });
    createContainer(t.db, { kind: "area", name: "Health" });
    const suggestion = suggestContainer(t.db, { title: "Weather report review", attendeeNames: ["Someone Else"] });
    expect(suggestion).toBeNull();
  });

  it("never returns a resource — only a project or an area, matching design §6", () => {
    createContainer(t.db, { kind: "resource", name: "Platform Guide" });
    const suggestion = suggestContainer(t.db, { title: "Platform sync", attendeeNames: [] });
    expect(suggestion).toBeNull();
  });

  it("prefers an area matched by an attendee already linked there, over nothing", () => {
    const area = createContainer(t.db, { kind: "area", name: "Health" });
    const person = createPerson(t.db, { name: "Nurse Ada" });
    const item = createItem(t.db, { type: "note", title: "Checkup", containerId: area.id });
    setItemPeople(t.db, item.id, [person.id]);
    const suggestion = suggestContainer(t.db, { title: "Annual visit", attendeeNames: ["Nurse Ada"] });
    expect(suggestion).toEqual({ id: area.id, name: area.name, slug: area.slug, kind: "area" });
  });

  it("costs one query for the containers and one for their people, for the whole list, never one per meeting", () => {
    const project = createContainer(t.db, { kind: "project", name: "Website Redesign" });
    const meetings = Array.from({ length: 12 }, (_, i) => ({ title: `Website standup ${i}`, attendeeNames: [] }));
    const spy = vi.spyOn(t.db, "select");
    const out = suggestContainersFor(t.db, meetings);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.every((s) => s?.id === project.id)).toBe(true);
  });
});
