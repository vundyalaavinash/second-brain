import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { planner: typeof import("./settings/planner/route") };
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { planner: await import("./settings/planner/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("planner settings api", () => {
  it("defaults to nine to six, accepts a sane range, rejects the rest", async () => {
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "09:00-18:00" });
    const ok = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "08:30-17:00" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ workHours: "08:30-17:00" });
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "17:00-08:30" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "nine to five" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { nope: 1 }))).status).toBe(400);
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "08:30-17:00" });
  });
});
