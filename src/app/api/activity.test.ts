import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: {
  heartbeat: typeof import("./activity/heartbeat/route");
  calendar: typeof import("./activity/calendar/route");
  day: typeof import("./activity/day/route");
  week: typeof import("./activity/week/route");
  rules: typeof import("./activity/rules/route");
  rule: typeof import("./activity/rules/[id]/route");
  reorder: typeof import("./activity/rules/reorder/route");
  exclusions: typeof import("./activity/exclusions/route");
  pause: typeof import("./activity/pause/route");
  capture: typeof import("./activity/meetings/[id]/capture/route");
  label: typeof import("./activity/sessions/[id]/label/route");
};
const TOKEN = "abc123";
const T0 = new Date(2026, 8, 16, 10, 0, 0).getTime(); // local 10:00 so every heartbeat lands on the same local day
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const day = "2026-09-16";

const json = (method: string, url: string, body?: unknown, token?: string) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  fs.writeFileSync(path.join(dir, "activity-token"), TOKEN + "\n");
  r = {
    heartbeat: await import("./activity/heartbeat/route"),
    calendar: await import("./activity/calendar/route"),
    day: await import("./activity/day/route"),
    week: await import("./activity/week/route"),
    rules: await import("./activity/rules/route"),
    rule: await import("./activity/rules/[id]/route"),
    reorder: await import("./activity/rules/reorder/route"),
    exclusions: await import("./activity/exclusions/route"),
    pause: await import("./activity/pause/route"),
    capture: await import("./activity/meetings/[id]/capture/route"),
    label: await import("./activity/sessions/[id]/label/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getDay = async () => (await (await r.day.GET(json("GET", `/api/activity/day?date=${day}`))).json()) as Record<string, any>;

describe("activity api", () => {
  it("rejects heartbeats without the token", async () => {
    const res = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(0), appId: "x" }));
    expect(res.status).toBe(401);
    const bad = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(0), appId: "x" }, "nope"));
    expect(bad.status).toBe(401);
  });

  it("ingests heartbeats, returns exclusions, stores helper state", async () => {
    const body = {
      at: at(0), appId: "com.microsoft.VSCode", appName: "Code", title: "a", url: null, idleSeconds: 1,
      helper: { version: "1.0.0", permissions: { accessibility: true, calendar: false, automation: {} } },
    };
    const res = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", body, TOKEN));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.exclusions.apps).toContain("com.1password.1password");
    expect(data.paused).toBe(false);
    await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { ...body, at: at(300) }, TOKEN));
    await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(305), appId: "x", appName: "x", title: null, url: null, idleSeconds: 400 }, TOKEN));
    const d = await getDay();
    expect(d.activeMs).toBe(305_000);
    expect(d.helper.permissions.accessibility).toBe(true);
    expect(d.helper.lastSeen).toBe(at(305));
    expect(d.sessions).toHaveLength(2);
    expect(d.retentionDays).toBe(90);
  });

  it("pauses, resumes, and sets retention", async () => {
    let res = await r.pause.POST(json("POST", "/api/activity/pause", { paused: true }));
    expect((await res.json()).paused).toBe(true);
    const hb = await r.heartbeat.POST(json("POST", "/api/activity/heartbeat", { at: at(600), appId: "com.microsoft.VSCode", appName: "Code", title: "b", url: null }, TOKEN));
    expect((await hb.json()).paused).toBe(true);
    expect((await getDay()).sessions).toHaveLength(2);
    res = await r.pause.POST(json("POST", "/api/activity/pause", { paused: false, retentionDays: 30 }));
    expect(await res.json()).toEqual({ paused: false, retentionDays: 30 });
    expect((await getDay()).retentionDays).toBe(30);
  });

  it("replaces calendar events and captures a meeting once", async () => {
    const res = await r.calendar.POST(json("POST", "/api/activity/calendar", { events: [{ externalId: "e1", title: "Interview: Jane", startsAt: at(1000), endsAt: at(2800), attendees: 2, hasCallLink: true }] }, TOKEN));
    expect(res.status).toBe(200);
    const d = await getDay();
    expect(d.meetings).toHaveLength(1);
    expect(d.meetings[0].interview).toBe(true);
    const c1 = await r.capture.POST(json("POST", "/x"), params(d.meetings[0].id));
    expect(c1.status).toBe(201);
    const c2 = await r.capture.POST(json("POST", "/x"), params(d.meetings[0].id));
    expect(c2.status).toBe(200);
    expect((await c1.json()).id).toBe((await c2.json()).id);
  });

  it("manages rules, reorders, and recategorises", async () => {
    const list = (await (await r.rules.GET()).json()) as { id: number }[];
    const cats = (await getDay()).categories as { id: number; name: string }[];
    const writing = cats.find((c) => c.name === "Writing")!.id;
    const created = await r.rules.POST(json("POST", "/api/activity/rules", { matchKind: "app", pattern: "com.microsoft.VSCode", categoryId: writing }));
    expect(created.status).toBe(201);
    const rule = (await created.json()) as { id: number };
    await r.reorder.POST(json("POST", "/api/activity/rules/reorder", { ids: [rule.id, ...list.map((x) => x.id)] }));
    const d = await getDay();
    expect(d.byCategory[0].categoryId).toBe(writing);
    const bad = await r.rules.POST(json("POST", "/api/activity/rules", { matchKind: "nope", pattern: "x", categoryId: writing }));
    expect(bad.status).toBe(400);
    const del = await r.rule.DELETE(json("DELETE", "/x"), params(rule.id));
    expect(del.status).toBe(204);
  });

  it("adds and rejects duplicate exclusions", async () => {
    const ok = await r.exclusions.POST(json("POST", "/api/activity/exclusions", { kind: "domain", pattern: "secret.example" }));
    expect(ok.status).toBe(201);
    const dup = await r.exclusions.POST(json("POST", "/api/activity/exclusions", { kind: "domain", pattern: "secret.example" }));
    expect(dup.status).toBe(409);
  });

  it("labels a session and serves a week", async () => {
    const d = await getDay();
    const leisure = (d.categories as { id: number; name: string }[]).find((c) => c.name === "Leisure")!.id;
    const res = await r.label.POST(json("POST", "/x", { categoryId: leisure }), params(d.sessions[0].id));
    expect(res.status).toBe(200);
    const w = (await (await r.week.GET(json("GET", `/api/activity/week?start=${day}`))).json()) as { days: { day: string }[] };
    expect(w.days).toHaveLength(7);
    const badDay = await r.day.GET(json("GET", "/api/activity/day?date=2026-9-1"));
    expect(badDay.status).toBe(400);
  });
});
