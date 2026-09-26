import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { eq } from "drizzle-orm";
import { activitySessions, calendarEvents } from "@/db/schema";
import { replaceCalendarEvents } from "./calendar";
import { setMeetingDecision } from "@/domain/meetings/decision";
import { ingestHeartbeat, getOpenSession, recategorise, pruneActivity, labelSession, EXCLUDED_APP_ID } from "./sessions";
import { listCategories, createRule, reorderRules, listRules } from "./rules";

const T0 = Date.parse("2026-09-16T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const code = (s: number, title = "a.ts") => ({ at: at(s), appId: "com.microsoft.VSCode", appName: "Code", title, url: null });
const chrome = (s: number, url: string, title = "tab") => ({ at: at(s), appId: "com.google.Chrome", appName: "Chrome", title, url });

describe("session folding", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  const all = () => t.db.select().from(activitySessions).orderBy(activitySessions.id).all();

  it("extends on the same key and splits on change", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, code(5));
    ingestHeartbeat(t.db, code(10));
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ startedAt: at(0), endedAt: at(10), heartbeats: 3, closed: 0 });
    ingestHeartbeat(t.db, chrome(15, "https://github.com/x"));
    const s = all();
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ endedAt: at(15), closed: 1 });
    expect(s[1]).toMatchObject({ startedAt: at(15), domain: "github.com", endedAt: at(15) });
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(s[0].categoryId).toBe(cats.Coding);
    expect(s[1].categoryId).toBe(cats.Coding);
  });

  it("debounces title flicker within 20 seconds, splits after", () => {
    ingestHeartbeat(t.db, code(0, "one"));
    ingestHeartbeat(t.db, code(5, "two"));
    expect(all()).toHaveLength(1);
    expect(all()[0].title).toBe("two");
    ingestHeartbeat(t.db, code(10, "three"));
    expect(all()).toHaveLength(1);
    ingestHeartbeat(t.db, code(40, "four"));
    expect(all()).toHaveLength(2);
  });

  it("afk closes the open session and opens an afk session", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, { at: at(200), afk: true });
    ingestHeartbeat(t.db, { at: at(205), afk: true });
    let s = all();
    expect(s).toHaveLength(2);
    expect(s[0].endedAt).toBe(at(200));
    expect(s[1]).toMatchObject({ afk: 1, startedAt: at(200), endedAt: at(205) });
    ingestHeartbeat(t.db, code(210));
    s = all();
    expect(s).toHaveLength(3);
    expect(s[1].endedAt).toBe(at(210));
  });

  it("closes at the last heartbeat across a gap over 15 minutes", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, code(5));
    ingestHeartbeat(t.db, code(5 + 16 * 60));
    const s = all();
    expect(s).toHaveLength(2);
    expect(s[0].endedAt).toBe(at(5));
    expect(s[1].startedAt).toBe(at(5 + 16 * 60));
  });

  it("ignores out-of-order heartbeats and excluded samples", () => {
    ingestHeartbeat(t.db, code(10));
    expect(ingestHeartbeat(t.db, code(5))).toBeNull();
    expect(all()).toHaveLength(1);
    expect(ingestHeartbeat(t.db, chrome(20, "https://chase.com/x"))).toBeNull();
    expect(all()).toHaveLength(1);
    expect(all()[0]).toMatchObject({ endedAt: at(20), closed: 1 });
    expect(getOpenSession(t.db)).toBeUndefined();
    ingestHeartbeat(t.db, code(25));
    expect(ingestHeartbeat(t.db, { at: at(30), appId: EXCLUDED_APP_ID, appName: "Excluded", title: null, url: null })).toBeNull();
    expect(all()).toHaveLength(2);
    expect(all()[1].closed).toBe(1);
  });

  it("does not collide keys across field boundaries", () => {
    ingestHeartbeat(t.db, { at: at(0), appId: "ab", appName: "AB", title: "cd", url: null });
    ingestHeartbeat(t.db, { at: at(5), appId: "a", appName: "A", title: "bcd", url: null });
    expect(all()).toHaveLength(2);
  });

  it("respects the gap rule when closing on an excluded sample", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, code(5));
    expect(ingestHeartbeat(t.db, chrome(5 + 20 * 60, "https://chase.com/x"))).toBeNull();
    const s = all();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ endedAt: at(5), closed: 1 });
  });

  it("recategorises after rules change and labels by hand", () => {
    ingestHeartbeat(t.db, chrome(0, "https://example.org"));
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(all()[0].categoryId).toBe(cats.Browsing);
    const r = createRule(t.db, { matchKind: "domain", pattern: "example.org", categoryId: cats.Writing });
    reorderRules(t.db, [r.id, ...listRules(t.db).filter((x) => x.id !== r.id).map((x) => x.id)]);
    expect(recategorise(t.db, 30, new Date(T0 + 60_000))).toBe(1);
    expect(all()[0].categoryId).toBe(cats.Writing);
    const labelled = labelSession(t.db, all()[0].id, { categoryId: cats.Leisure });
    expect(labelled.categoryId).toBe(cats.Leisure);
    expect(() => labelSession(t.db, 999, { categoryId: null })).toThrow(/not found/);
    expect(() => labelSession(t.db, all()[0].id, { categoryId: 999 })).toThrow(/Category not found/);
  });

  it("falls back to Other when no rule matches", () => {
    ingestHeartbeat(t.db, { at: at(0), appId: "com.unknown.app", appName: "Mystery", title: "x", url: null });
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(all()[0].categoryId).toBe(cats.Other);
  });

  it("keeps a manual label through recategorise, and drops back to rules when cleared", () => {
    ingestHeartbeat(t.db, chrome(0, "https://example.org"));
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    expect(all()[0].categoryId).toBe(cats.Browsing);
    const id = all()[0].id;
    const labelled = labelSession(t.db, id, { categoryId: cats.Leisure });
    expect(labelled.categoryId).toBe(cats.Leisure);
    const r = createRule(t.db, { matchKind: "domain", pattern: "example.org", categoryId: cats.Writing });
    reorderRules(t.db, [r.id, ...listRules(t.db).filter((x) => x.id !== r.id).map((x) => x.id)]);
    expect(recategorise(t.db, 30, new Date(T0 + 60_000))).toBe(0);
    expect(all()[0].categoryId).toBe(cats.Leisure);
    const cleared = labelSession(t.db, id, { categoryId: null });
    expect(cleared.categoryId).toBeNull();
    expect(recategorise(t.db, 30, new Date(T0 + 60_000))).toBe(1);
    expect(all()[0].categoryId).toBe(cats.Writing);
  });

  it("prunes by retention", () => {
    ingestHeartbeat(t.db, code(0));
    ingestHeartbeat(t.db, { ...code(0), at: new Date(T0 + 100 * 86_400_000).toISOString() });
    expect(pruneActivity(t.db, 90, new Date(T0 + 100 * 86_400_000)).sessions).toBe(1);
    expect(all()).toHaveLength(1);
  });

  // F-E (final whole-branch review): the purge deleted any calendar row past the cutoff, including
  // one carrying a decision the person made. Because `replaceCalendarEvents`'s resync window
  // reaches ~30 days back and `decision` is excluded from its upsert's `set` clause, a purged row
  // re-inserted later lands `decision: NULL` -- silently reverting "Not going" to "going".
  it("never purges a calendar event carrying a person's own decision, however old", () => {
    const longAgo = new Date(T0 - 400 * 86_400_000);
    replaceCalendarEvents(t.db, [
      { externalId: "decided", title: "Weekly sync", startsAt: longAgo.toISOString(), endsAt: new Date(longAgo.getTime() + 1800_000).toISOString(), attendees: 3, hasCallLink: true },
      { externalId: "undecided", title: "Weekly sync", startsAt: longAgo.toISOString(), endsAt: new Date(longAgo.getTime() + 1800_000).toISOString(), attendees: 3, hasCallLink: true },
    ]);
    const decided = t.db.select().from(calendarEvents).where(eq(calendarEvents.externalId, "decided")).get()!;
    setMeetingDecision(t.db, decided.id, { decision: "not-going", note: "Nothing for me in this one", scope: "occurrence" });

    // A one-day retention window, the most aggressive the setting allows.
    expect(pruneActivity(t.db, 1, new Date(T0)).events).toBe(1);
    const left = t.db.select().from(calendarEvents).all();
    expect(left.map((e) => e.externalId)).toEqual(["decided"]);
    // Intact, note and all -- not merely undeleted.
    expect(left[0]).toMatchObject({ decision: "not-going", decisionNote: "Nothing for me in this one" });
  });
});
