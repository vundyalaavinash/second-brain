import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { meetings: typeof import("./settings/meetings/route") };
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

/** The same request as `json`, but from a page on another origin -- what `crossSite` gates on. */
const foreign = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { origin: "https://evil.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { meetings: await import("./settings/meetings/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("meeting settings api", () => {
  it("starts off with the link rule on and a seven-day audio window, patches one switch at a time, and rejects bad bodies", async () => {
    expect(await (await r.meetings.GET()).json()).toEqual({ autoRecord: false, autoRecordNeedsCallLink: true, audioRetentionDays: 7 });
    const on = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecord: true }));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: true, audioRetentionDays: 7 });
    const loose = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecordNeedsCallLink: false }));
    expect(await loose.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false, audioRetentionDays: 7 });
    expect(await (await r.meetings.GET()).json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false, audioRetentionDays: 7 });
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecord: "yes" }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { nope: true }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings"))).status).toBe(400);
  });

  it("saves the audio retention window independently of the switches, and null means keep forever", async () => {
    const ok = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: 30 }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false, audioRetentionDays: 30 });

    const forever = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: null }));
    expect(forever.status).toBe(200);
    expect(await forever.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false, audioRetentionDays: null });

    // Restore for the tests that follow.
    await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: 7 }));
  });

  it("rejects an audio retention window outside 0-365", async () => {
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: -1 }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: 366 }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: 1.5 }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { audioRetentionDays: "7" }))).status).toBe(400);
    // Nothing above landed.
    expect(await (await r.meetings.GET()).json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false, audioRetentionDays: 7 });
  });

  it("gates PATCH on the same-origin guard, and the write never happens", async () => {
    const before = await (await r.meetings.GET()).json();
    const res = await r.meetings.PATCH(foreign("PATCH", "/api/settings/meetings", { audioRetentionDays: 1, autoRecord: true }));
    expect(res.status).toBe(403);
    expect(await (await r.meetings.GET()).json()).toEqual(before);
  });
});
