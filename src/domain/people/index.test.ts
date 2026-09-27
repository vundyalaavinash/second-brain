import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { createItem, updateItem } from "@/domain/items";
import { captureNote, updateItemContent } from "@/domain/items/capture";
import {
  createPerson,
  getPerson,
  getPersonBySlug,
  listPeople,
  updatePerson,
  deletePerson,
  setItemPeople,
  addItemPerson,
  getItemPeople,
  getPersonTimeline,
  extractMentions,
  autoLinkMentions,
  PersonError,
} from "./index";

describe("people domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("creates, lists with counts, updates, and deletes people", () => {
    const ada = createPerson(t.db, { name: "Ada Lovelace" });
    expect(ada.slug).toBe("ada-lovelace");
    const ada2 = createPerson(t.db, { name: "Ada Lovelace" });
    expect(ada2.slug).toBe("ada-lovelace-2");
    expect(getPersonBySlug(t.db, "ada-lovelace")?.id).toBe(ada.id);
    const item = createItem(t.db, { type: "note", title: "n" });
    setItemPeople(t.db, item.id, [ada.id]);
    expect(listPeople(t.db).map((p) => [p.slug, p.itemCount])).toEqual([
      ["ada-lovelace", 1],
      ["ada-lovelace-2", 0],
    ]);
    updateItem(t.db, item.id, { archivedAt: new Date().toISOString() });
    expect(listPeople(t.db).find((x) => x.id === ada.id)?.itemCount).toBe(0);
    const u = updatePerson(t.db, ada.id, { name: "Countess Ada", profile: "Mathematician" });
    expect(u.slug).toBe("countess-ada");
    expect(getPerson(t.db, ada.id)?.profile).toBe("Mathematician");
    expect(() => updatePerson(t.db, 999, { name: "x" })).toThrow(PersonError);
    deletePerson(t.db, ada2.id);
    expect(listPeople(t.db)).toHaveLength(1);
  });

  it("links items to people and builds a timeline newest first", () => {
    const p = createPerson(t.db, { name: "Grace" });
    const a = createItem(t.db, { type: "note", title: "a" });
    const b = createItem(t.db, { type: "note", title: "b" });
    addItemPerson(t.db, a.id, p.id);
    addItemPerson(t.db, a.id, p.id);
    addItemPerson(t.db, b.id, p.id);
    expect(getItemPeople(t.db, a.id).map((x) => x.id)).toEqual([p.id]);
    expect(getPersonTimeline(t.db, p.id).map((i) => i.id)).toEqual([b.id, a.id]);
    updateItem(t.db, b.id, { archivedAt: new Date().toISOString() });
    expect(listPeople(t.db).find((x) => x.id === p.id)?.itemCount).toBe(1);
    expect(getPersonTimeline(t.db, p.id).map((i) => i.id)).toEqual([a.id]);
    expect(getPersonTimeline(t.db, p.id, true)).toHaveLength(2);
    setItemPeople(t.db, a.id, []);
    expect(getItemPeople(t.db, a.id)).toEqual([]);
  });

  it("counts meetings and remembers when anything was last linked", () => {
    const p = createPerson(t.db, { name: "Grace" });
    const note = createItem(t.db, { type: "note", title: "chat" });
    addItemPerson(t.db, note.id, p.id);
    const meeting = createItem(t.db, { type: "meeting", title: "sync" });
    addItemPerson(t.db, meeting.id, p.id);
    const row = listPeople(t.db).find((x) => x.id === p.id);
    expect(row?.meetingCount).toBe(1);
    expect(row?.lastContact).toBe([note.createdAt, meeting.createdAt].sort().at(-1));
  });

  it("says nothing was ever linked, for someone nobody has mentioned", () => {
    const p = createPerson(t.db, { name: "Nobody" });
    const row = listPeople(t.db).find((x) => x.id === p.id);
    expect(row?.lastContact).toBeNull();
    expect(row?.meetingCount).toBe(0);
  });

  it("extracts and auto-links @mentions", () => {
    expect(extractMentions("met @ada-lovelace and @Grace, not email@x.com")).toEqual(["ada-lovelace", "grace"]);
    const ada = createPerson(t.db, { name: "Ada Lovelace" });
    const grace = createPerson(t.db, { name: "Grace Hopper" });
    const note = captureNote(t.db, { body: "Lunch with @ada-lovelace and @grace-hopper about @nobody" });
    expect(getItemPeople(t.db, note.id).map((p) => p.id).sort()).toEqual([ada.id, grace.id].sort());
    const again = autoLinkMentions(t.db, note.id);
    expect(again).toBe(0);
    updateItemContent(t.db, note.id, { body: "Only @grace-hopper now" });
    expect(getItemPeople(t.db, note.id).map((p) => p.id).sort()).toEqual([ada.id, grace.id].sort());
  });
});
