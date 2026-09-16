import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { getDay, getWeek, addDays } from "./report";
import { ingestHeartbeat } from "./sessions";
import { replaceCalendarEvents, captureMeeting, dayBounds } from "./calendar";
import { listCategories } from "./rules";
import { calendarEvents } from "@/db/schema";

describe("activity reports", () => {
  let t: TestDb;
  beforeEach(() => { t = makeTestDb(); });
  afterEach(() => t.cleanup());

  it("totals a day by category, app, and site, clipped to the day", () => {
    const day = "2026-09-16";
    const { start, end } = dayBounds(day);
    const S = Date.parse(start);
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    ingestHeartbeat(t.db, { at: at(3600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 600), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: at(3600 + 605), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 905), appId: "com.google.Chrome", appName: "Chrome", title: "GitHub", url: "https://github.com/x" });
    ingestHeartbeat(t.db, { at: at(3600 + 910), afk: true });
    ingestHeartbeat(t.db, { at: at(3600 + 1000), afk: true });
    const E = Date.parse(end);
    ingestHeartbeat(t.db, { at: new Date(E - 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });
    ingestHeartbeat(t.db, { at: new Date(E + 60_000).toISOString(), appId: "com.apple.Notes", appName: "Notes", title: "n", url: null });

    const d = getDay(t.db, day);
    const cats = Object.fromEntries(listCategories(t.db).map((c) => [c.name, c.id]));
    // Code 600s, Chrome 300s, afk 90s (excluded from active), Notes 60s inside the day; the two 5s hand-offs count too.
    expect(d.activeMs).toBe(600_000 + 5_000 + 300_000 + 5_000 + 60_000);
    const coding = d.byCategory.find((c) => c.categoryId === cats.Coding)!;
    expect(coding.ms).toBe(600_000 + 5_000 + 300_000 + 5_000);
    expect(d.byApp[0]).toMatchObject({ appId: "com.microsoft.VSCode" });
    expect(d.bySite.find((s) => s.key === "github.com")?.ms).toBe(305_000);
    expect(d.sessions.some((s) => s.afk)).toBe(true);
    expect(d.sessions.every((s) => s.startedAt >= start && s.endedAt <= end)).toBe(true);
  });

  it("reports meetings with scheduled versus actual minutes and capture state", () => {
    const day = "2026-09-16";
    const S = Date.parse(dayBounds(day).start) + 10 * 3600_000;
    const at = (s: number) => new Date(S + s * 1000).toISOString();
    replaceCalendarEvents(t.db, [{ externalId: "a", title: "Interview: Jane", startsAt: at(0), endsAt: at(1800), attendees: 2, hasCallLink: true }]);
    // Heartbeats 600s apart: within GAP_MS (15min) so they fold into one session (600s span, not a split at each hb).
    ingestHeartbeat(t.db, { at: at(60), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    ingestHeartbeat(t.db, { at: at(660), appId: "us.zoom.xos", appName: "zoom.us", title: "Zoom Meeting", url: null });
    let d = getDay(t.db, day);
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0]).toMatchObject({ title: "Interview: Jane", interview: true, scheduledMs: 1800_000, actualMs: 600_000, itemId: null });
    const ev = t.db.select().from(calendarEvents).get()!;
    const item = captureMeeting(t.db, ev.id);
    d = getDay(t.db, day);
    expect(d.meetings[0].itemId).toBe(item.id);
  });

  it("builds a week of daily category totals", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    const S = Date.parse(dayBounds("2026-09-14").start) + 9 * 3600_000;
    ingestHeartbeat(t.db, { at: new Date(S).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    ingestHeartbeat(t.db, { at: new Date(S + 120_000).toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null });
    const w = getWeek(t.db, "2026-09-14");
    expect(w.days).toHaveLength(7);
    expect(w.days[0].day).toBe("2026-09-14");
    expect(w.days[0].activeMs).toBe(120_000);
    expect(w.days[6].day).toBe("2026-09-20");
    expect(w.days[6].activeMs).toBe(0);
  });
});
