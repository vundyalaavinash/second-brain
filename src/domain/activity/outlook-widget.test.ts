import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { macTimeToIso, outlookStorePath, parseOutlookWidgetStore, syncOutlookWidget } from "./outlook-widget";
import { localDay, replaceCalendarEvents } from "./calendar";

/** One day's worth of the interleaved [timestamp, [events]] shape the real file uses. */
function day(macTimestamp: number, events: unknown[]): unknown[] {
  return [macTimestamp, events];
}

function event(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stableAppointmentID: "AAKBOQ-1",
    subject: "FEX deployments India",
    startTime: 812473200,
    endTime: 812476800,
    location: "https://coupang.zoom.us/j/12345",
    isAllDay: false,
    isCancelled: false,
    calendar: { id: "AAMKAGUW", name: "Calendar" },
    ...over,
  };
}

describe("macTimeToIso", () => {
  it("converts the Core Foundation epoch to Unix", () => {
    // 0 seconds since 2001-01-01 is exactly that instant, not 1970.
    expect(macTimeToIso(0)).toBe("2001-01-01T00:00:00.000Z");
  });
});

describe("parseOutlookWidgetStore", () => {
  it("walks the flat interleaved array rather than treating it as pairs", () => {
    const store = {
      dayToAppointments: [
        ...day(812473200, [event({ stableAppointmentID: "a", subject: "One" })]),
        ...day(812559600, [event({ stableAppointmentID: "b", subject: "Two", startTime: 812559600 })]),
      ],
    };
    const events = parseOutlookWidgetStore(store);
    expect(events.map((e) => e.title)).toEqual(["One", "Two"]);
  });

  it("maps the fields the rest of the calendar pipeline expects", () => {
    const [e] = parseOutlookWidgetStore({ dayToAppointments: day(812473200, [event()]) });
    expect(e.externalId).toBe("outlook:AAKBOQ-1");
    expect(e.title).toBe("FEX deployments India");
    expect(e.startsAt).toBe(macTimeToIso(812473200));
    expect(e.endsAt).toBe(macTimeToIso(812476800));
    expect(e.calendarTitle).toBe("Calendar");
    expect(e.allDay).toBe(false);
  });

  it("pulls a join url out of the location", () => {
    const [e] = parseOutlookWidgetStore({ dayToAppointments: day(812473200, [event()]) });
    expect(e.joinUrl).toBe("https://coupang.zoom.us/j/12345");
    expect(e.hasCallLink).toBe(true);
  });

  it("pulls a join url out of the notes when the location has none", () => {
    const [e] = parseOutlookWidgetStore({
      dayToAppointments: day(812473200, [
        event({ location: "Meeting Room 4", notes: "dial in: https://coupang.zoom.us/j/999" }),
      ]),
    });
    expect(e.joinUrl).toBe("https://coupang.zoom.us/j/999");
    expect(e.location).toBe("Meeting Room 4");
  });

  it("has no call link when neither field carries a url", () => {
    const [e] = parseOutlookWidgetStore({
      dayToAppointments: day(812473200, [event({ location: "Meeting Room 4", notes: undefined })]),
    });
    expect(e.hasCallLink).toBe(false);
    expect(e.joinUrl).toBeNull();
  });

  it("groups a title seen on two or more distinct days into one series", () => {
    const store = {
      dayToAppointments: [
        ...day(812473200, [event({ stableAppointmentID: "d1", subject: "Standup", startTime: 812473200 })]),
        ...day(812559600, [event({ stableAppointmentID: "d2", subject: "Standup", startTime: 812559600 })]),
      ],
    };
    const [a, b] = parseOutlookWidgetStore(store);
    expect(a.seriesId).toBe(b.seriesId);
    expect(a.seriesId).toBe("outlook-series:Standup");
  });

  it("leaves a title seen on a single day as its own series of one", () => {
    const store = {
      dayToAppointments: day(812473200, [
        event({ stableAppointmentID: "x", subject: "One off", startTime: 812473200 }),
        event({ stableAppointmentID: "y", subject: "Also one off", startTime: 812480000 }),
      ]),
    };
    const events = parseOutlookWidgetStore(store);
    expect(events[0].seriesId).toBe("outlook:x");
    expect(events[1].seriesId).toBe("outlook:y");
  });

  it("counts distinct days, not occurrences, so twice in one day is not a series", () => {
    const start = 812473200;
    const store = {
      dayToAppointments: day(start, [
        event({ stableAppointmentID: "m1", subject: "Sync", startTime: start }),
        event({ stableAppointmentID: "m2", subject: "Sync", startTime: start + 3600 }),
      ]),
    };
    const events = parseOutlookWidgetStore(store);
    expect(localDay(events[0].startsAt)).toBe(localDay(events[1].startsAt));
    expect(events[0].seriesId).not.toBe(events[1].seriesId);
  });

  it("drops cancelled meetings", () => {
    const store = {
      dayToAppointments: day(812473200, [
        event({ stableAppointmentID: "keep", subject: "Real" }),
        event({ stableAppointmentID: "gone", subject: "Cancelled", isCancelled: true }),
      ]),
    };
    expect(parseOutlookWidgetStore(store).map((e) => e.title)).toEqual(["Real"]);
  });

  it("keeps one row when an appointment repeats across day buckets", () => {
    const store = {
      dayToAppointments: [
        ...day(812473200, [event({ stableAppointmentID: "same" })]),
        ...day(812559600, [event({ stableAppointmentID: "same" })]),
      ],
    };
    expect(parseOutlookWidgetStore(store)).toHaveLength(1);
  });

  it("skips entries missing the fields it cannot invent", () => {
    const store = {
      dayToAppointments: day(812473200, [
        event({ stableAppointmentID: undefined }),
        event({ subject: undefined }),
        event({ startTime: undefined }),
        event({ endTime: undefined }),
        event({ stableAppointmentID: "ok" }),
      ]),
    };
    expect(parseOutlookWidgetStore(store).map((e) => e.externalId)).toEqual(["outlook:ok"]);
  });

  // The file is an undocumented Outlook internal; a shape change must mean "no Outlook events",
  // never a crash that takes the rest of the calendar sync down with it.
  it.each([
    ["null", null],
    ["a string", "nope"],
    ["missing dayToAppointments", {}],
    ["dayToAppointments as an object", { dayToAppointments: { "812473200": [] } }],
    ["events that are not objects", { dayToAppointments: [812473200, ["nope", 42, null]] }],
    ["an odd-length array", { dayToAppointments: [812473200] }],
  ])("returns nothing for %s", (_label, input) => {
    expect(parseOutlookWidgetStore(input)).toEqual([]);
  });
});

describe("syncOutlookWidget", () => {
  let t: TestDb;
  let home: string;

  beforeEach(() => {
    t = makeTestDb();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "sb-outlook-"));
  });
  afterEach(() => {
    t.cleanup();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function writeStore(contents: string): void {
    const file = outlookStorePath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }

  const NOW = new Date("2026-09-23T06:00:00.000Z");

  it("is off, not failing, when Outlook's widget cache does not exist", () => {
    // The overwhelmingly common case: any Mac without Outlook's calendar widget.
    expect(syncOutlookWidget(t.db, { home, now: NOW })).toEqual({ state: "off" });
  });

  it("stores the meetings it finds under the outlook source", () => {
    writeStore(JSON.stringify({ dayToAppointments: day(812473200, [event()]) }));
    const result = syncOutlookWidget(t.db, { home, now: NOW });
    expect(result.state).toBe("ok");
    expect(result.count).toBe(1);
    const rows = t.db.$client.prepare("SELECT source, title, join_url FROM calendar_events").all() as {
      source: string; title: string; join_url: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("outlook");
    expect(rows[0].title).toBe("FEX deployments India");
    expect(rows[0].join_url).toBe("https://coupang.zoom.us/j/12345");
  });

  it("reports an error and keeps existing rows when the file is not JSON", () => {
    writeStore(JSON.stringify({ dayToAppointments: day(812473200, [event()]) }));
    expect(syncOutlookWidget(t.db, { home, now: NOW }).state).toBe("ok");

    // An Outlook update changing the format must not wipe what was already synced.
    writeStore("<html>not json at all</html>");
    expect(syncOutlookWidget(t.db, { home, now: NOW }).state).toBe("error");
    const count = (t.db.$client.prepare("SELECT COUNT(*) c FROM calendar_events").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("does not delete previously synced rows when the cache reads empty", () => {
    writeStore(JSON.stringify({ dayToAppointments: day(812473200, [event()]) }));
    syncOutlookWidget(t.db, { home, now: NOW });
    writeStore(JSON.stringify({ dayToAppointments: [] }));
    const result = syncOutlookWidget(t.db, { home, now: NOW });
    expect(result).toMatchObject({ state: "ok", count: 0 });
    const count = (t.db.$client.prepare("SELECT COUNT(*) c FROM calendar_events").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it("leaves another source's rows alone", () => {
    writeStore(JSON.stringify({ dayToAppointments: day(812473200, [event()]) }));
    replaceCalendarEvents(
      t.db,
      [{
        externalId: "eventkit:abc", title: "Holiday", startsAt: macTimeToIso(812473200),
        endsAt: macTimeToIso(812476800), attendees: 0, hasCallLink: false,
      }],
      undefined, {}, { source: "eventkit" },
    );
    syncOutlookWidget(t.db, { home, now: NOW });
    const bySource = t.db.$client
      .prepare("SELECT source, COUNT(*) c FROM calendar_events GROUP BY source ORDER BY source")
      .all() as { source: string; c: number }[];
    expect(bySource).toEqual([{ source: "eventkit", c: 1 }, { source: "outlook", c: 1 }]);
  });
});
