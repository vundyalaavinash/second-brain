import fs from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let decisionRoute: typeof import("./meetings/[id]/decision/route");

const patch = (url: string, body: unknown, origin?: string) =>
  new Request(`http://localhost${url}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  decisionRoute = await import("./meetings/[id]/decision/route");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("PATCH /api/meetings/[id]/decision", () => {
  it("writes an occurrence decision and answers with the resolved meeting", async () => {
    const { getDb } = await import("@/db/client");
    const { replaceCalendarEvents } = await import("@/domain/activity/calendar");
    const db = getDb();
    replaceCalendarEvents(db, [
      { externalId: "occ-1", title: "Weekly sync", startsAt: "2026-09-21T09:00:00.000Z", endsAt: "2026-09-21T09:30:00.000Z", attendees: 2, hasCallLink: false },
    ]);
    const { calendarEvents } = await import("@/db/schema");
    const ev = db.select().from(calendarEvents).all().find((e) => e.externalId === "occ-1")!;

    const res = await decisionRoute.PATCH(patch(`/api/meetings/${ev.id}/decision`, { decision: "maybe", scope: "occurrence" }), params(ev.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: string; decisionNote: string };
    expect(body.decision).toBe("maybe");
    expect(body.decisionNote).toBe("");
  });

  it("400s a series-scoped write on a one-off meeting, and leaves it unchanged", async () => {
    const { getDb } = await import("@/db/client");
    const { replaceCalendarEvents } = await import("@/domain/activity/calendar");
    const { calendarEvents } = await import("@/db/schema");
    const db = getDb();
    replaceCalendarEvents(db, [
      { externalId: "occ-2", title: "One-off", startsAt: "2026-09-21T10:00:00.000Z", endsAt: "2026-09-21T10:30:00.000Z", attendees: 1, hasCallLink: false },
    ]);
    const ev = db.select().from(calendarEvents).all().find((e) => e.externalId === "occ-2")!;

    const res = await decisionRoute.PATCH(patch(`/api/meetings/${ev.id}/decision`, { decision: "not-going", scope: "series" }), params(ev.id));
    expect(res.status).toBe(400);
    const after = db.select().from(calendarEvents).all().find((e) => e.externalId === "occ-2")!;
    expect(after.decision).toBeNull();
  });

  it("400s a malformed body", async () => {
    const res = await decisionRoute.PATCH(patch("/api/meetings/1/decision", { decision: "definitely-going" }), params(1));
    expect(res.status).toBe(400);
  });

  it("gates on the same-origin guard, and the row survives untouched", async () => {
    const { getDb } = await import("@/db/client");
    const { replaceCalendarEvents } = await import("@/domain/activity/calendar");
    const { calendarEvents } = await import("@/db/schema");
    const db = getDb();
    replaceCalendarEvents(db, [
      { externalId: "occ-3", title: "Gated", startsAt: "2026-09-21T11:00:00.000Z", endsAt: "2026-09-21T11:30:00.000Z", attendees: 1, hasCallLink: false },
    ]);
    const ev = db.select().from(calendarEvents).all().find((e) => e.externalId === "occ-3")!;

    const res = await decisionRoute.PATCH(
      patch(`/api/meetings/${ev.id}/decision`, { decision: "not-going", scope: "occurrence" }, "https://evil.example"),
      params(ev.id),
    );
    expect(res.status).toBe(403);
    const after = db.select().from(calendarEvents).all().find((e) => e.externalId === "occ-3")!;
    expect(after.decision).toBeNull();
  });

  it("writes a series decision that a sibling occurrence with no override of its own then resolves to", async () => {
    const { getDb } = await import("@/db/client");
    const { replaceCalendarEvents } = await import("@/domain/activity/calendar");
    const { calendarEvents } = await import("@/db/schema");
    const db = getDb();
    replaceCalendarEvents(db, [
      {
        externalId: "occ-4a",
        title: "Recurring",
        startsAt: "2026-09-21T12:00:00.000Z",
        endsAt: "2026-09-21T12:30:00.000Z",
        attendees: 1,
        hasCallLink: false,
        seriesId: "eventkit:series-x",
      },
      {
        externalId: "occ-4b",
        title: "Recurring",
        startsAt: "2026-09-28T12:00:00.000Z",
        endsAt: "2026-09-28T12:30:00.000Z",
        attendees: 1,
        hasCallLink: false,
        seriesId: "eventkit:series-x",
      },
    ]);
    const rows = db.select().from(calendarEvents).all().filter((e) => e.seriesId === "eventkit:series-x");
    const first = rows.find((e) => e.externalId === "occ-4a")!;
    const second = rows.find((e) => e.externalId === "occ-4b")!;

    const res = await decisionRoute.PATCH(patch(`/api/meetings/${first.id}/decision`, { decision: "not-going", scope: "series" }), params(first.id));
    expect(res.status).toBe(200);

    const { serializeMeetingResolved } = await import("@/lib/api");
    expect(serializeMeetingResolved(db, second).decision).toBe("not-going");
  });
});
