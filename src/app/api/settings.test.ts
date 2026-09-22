import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { meetings: typeof import("./settings/meetings/route") };
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { meetings: await import("./settings/meetings/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("meeting settings api", () => {
  it("starts off with the link rule on, patches one switch at a time, and rejects bad bodies", async () => {
    expect(await (await r.meetings.GET()).json()).toEqual({ autoRecord: false, autoRecordNeedsCallLink: true });
    const on = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecord: true }));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: true });
    const loose = await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecordNeedsCallLink: false }));
    expect(await loose.json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false });
    expect(await (await r.meetings.GET()).json()).toEqual({ autoRecord: true, autoRecordNeedsCallLink: false });
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { autoRecord: "yes" }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings", { nope: true }))).status).toBe(400);
    expect((await r.meetings.PATCH(json("PATCH", "/api/settings/meetings"))).status).toBe(400);
  });
});
