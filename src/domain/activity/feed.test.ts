import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { calendarEvents } from "@/db/schema";
import { makeTestDb, type TestDb } from "@/test/db";
import { getSetting, setSetting } from "@/domain/settings";
import { localDay, replaceCalendarEvents } from "./calendar";
import { FEED_URL_KEY, getFeedState, normalizeFeedUrl, parseCalendarFeed, setFeedUrl, syncCalendarFeed } from "./feed";

const ICS = fs.readFileSync(path.join(process.cwd(), "src/test/fixtures/outlook-feed.ics"), "utf8");
const WINDOW = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

describe("parseCalendarFeed", () => {
  const parsed = parseCalendarFeed(ICS, WINDOW);
  const byId = new Map(parsed.events.map((e) => [e.externalId, e]));

  it("names the calendar and keeps only what touches the window", () => {
    expect(parsed.calendarTitle).toBe("Avinash's calendar");
    expect(parsed.events).toHaveLength(7);
    expect([...byId.keys()].some((id) => id.includes("old-1") || id.includes("cancelled-1"))).toBe(false);
  });

  it("reads a timed event in the feed's own timezone, with people and the join link", () => {
    const e = byId.get("feed:single-1")!;
    expect(e.startsAt).toBe("2026-09-24T04:30:00.000Z");
    expect(e.endsAt).toBe("2026-09-24T05:00:00.000Z");
    expect(e.organizer).toBe("Ada Lovelace");
    expect(e.attendeeNames).toEqual(["Grace Hopper", "Avinash V"]);
    expect(e.attendees).toBe(2);
    expect(e.joinUrl).toBe("https://teams.microsoft.com/l/meetup-join/abc");
    expect(e.hasCallLink).toBe(true);
    expect(e.status).toBe("accepted");
    expect(e.allDay).toBe(false);
    expect(e.calendarTitle).toBe("Avinash's calendar");
  });

  it("marks an all-day event on its day", () => {
    const e = byId.get("feed:allday-1")!;
    expect(e.allDay).toBe(true);
    expect(localDay(e.startsAt)).toBe("2026-09-25");
    expect(e.status).toBe("accepted");
  });

  it("expands a weekly rule, honours the exception date and the moved instance", () => {
    const standups = parsed.events.filter((e) => e.externalId.startsWith("feed:weekly-1:"));
    expect(standups.map((e) => e.startsAt)).toEqual([
      "2026-09-21T03:30:00.000Z",
      "2026-10-05T04:30:00.000Z",
      "2026-10-12T03:30:00.000Z",
      "2026-10-19T03:30:00.000Z",
      "2026-10-26T03:30:00.000Z",
    ]);
    const moved = standups.find((e) => e.startsAt.startsWith("2026-10-05"))!;
    expect(moved.title).toBe("Standup (moved)");
    expect(moved.externalId).toBe("feed:weekly-1:2026-10-05T03:30:00.000Z");
    expect(standups[0].status).toBe("tentative");
  });
});

describe("feed url", () => {
  it("accepts https and webcal, rejects anything else", () => {
    expect(normalizeFeedUrl(" webcal://outlook.live.com/owa/calendar/x/calendar.ics ")).toBe("https://outlook.live.com/owa/calendar/x/calendar.ics");
    expect(normalizeFeedUrl("")).toBe("");
    expect(() => normalizeFeedUrl("ftp://x/y.ics")).toThrow(/https/);
    expect(() => normalizeFeedUrl("not a url")).toThrow();
  });
});

describe("syncCalendarFeed", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  const NOW = new Date("2026-09-23T06:00:00.000Z");
  const fetchWith = (body: string, status = 200) =>
    vi.fn(async (url: string | URL | Request) => new Response(body, { status, headers: { "content-type": "text/calendar", "x-url": String(url) } })) as unknown as typeof fetch & {
      mock: { calls: [string][] };
    };

  it("does nothing without a link", async () => {
    const f = fetchWith(ICS);
    expect(await syncCalendarFeed(t.db, { fetch: f, now: NOW })).toEqual({ state: "off" });
    expect(f).not.toHaveBeenCalled();
  });

  it("writes the feed's events, keeps the helper's rows, and records the sync", async () => {
    replaceCalendarEvents(t.db, [
      { externalId: "ek-1", title: "From EventKit", startsAt: "2026-09-24T08:00:00.000Z", endsAt: "2026-09-24T08:30:00.000Z", attendees: 1, hasCallLink: false },
    ]);
    setFeedUrl(t.db, "https://example.com/cal.ics");
    const f = fetchWith(ICS);
    const r = await syncCalendarFeed(t.db, { fetch: f, now: NOW });
    expect(r).toMatchObject({ state: "ok", count: 7, syncedAt: NOW.toISOString() });
    expect(f.mock.calls[0][0]).toBe("https://example.com/cal.ics");
    const rows = t.db.select().from(calendarEvents).all();
    expect(rows.filter((r) => r.source === "feed")).toHaveLength(7);
    expect(rows.find((r) => r.externalId === "ek-1")?.source).toBe("eventkit");
    expect(getFeedState(t.db)).toEqual({ feedUrl: "https://example.com/cal.ics", syncedAt: NOW.toISOString(), error: null, count: 7 });

    // A second sync with one event gone purges only the feed's own vanished row.
    const fewer = ICS.replace(/BEGIN:VEVENT\nUID:single-1[\s\S]*?END:VEVENT\n/, "");
    expect(await syncCalendarFeed(t.db, { fetch: fetchWith(fewer), now: NOW })).toMatchObject({ state: "ok", count: 6 });
    const after = t.db.select().from(calendarEvents).all();
    expect(after.some((r) => r.externalId === "feed:single-1")).toBe(false);
    expect(after.some((r) => r.externalId === "ek-1")).toBe(true);
  });

  it("keeps what it has and records the error when the link fails or is not a calendar", async () => {
    setFeedUrl(t.db, "https://example.com/cal.ics");
    await syncCalendarFeed(t.db, { fetch: fetchWith(ICS), now: NOW });
    expect(await syncCalendarFeed(t.db, { fetch: fetchWith("<html>", 200), now: NOW })).toEqual({ state: "error", error: "That link is not a calendar feed" });
    expect(await syncCalendarFeed(t.db, { fetch: fetchWith("", 404), now: NOW })).toEqual({ state: "error", error: "The link answered 404" });
    expect(t.db.select().from(calendarEvents).where(eq(calendarEvents.source, "feed")).all()).toHaveLength(7);
    expect(getFeedState(t.db).error).toBe("The link answered 404");
    const down = vi.fn(async () => {
      throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    }) as unknown as typeof fetch;
    expect(await syncCalendarFeed(t.db, { fetch: down, now: NOW })).toEqual({ state: "error", error: "Could not reach the link (ECONNREFUSED)" });
    expect(getSetting(t.db, FEED_URL_KEY, "")).toBe("https://example.com/cal.ics");
  });

  it("clearing the link forgets the sync state", () => {
    setSetting(t.db, "calendar.feedSyncedAt", "2026-09-23T06:00:00.000Z");
    expect(setFeedUrl(t.db, "")).toEqual({ feedUrl: "", syncedAt: null, error: null, count: 0 });
  });
});
