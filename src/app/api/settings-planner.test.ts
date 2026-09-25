import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: { planner: typeof import("./settings/planner/route") };
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

/** The same request as `json`, but from a page on another origin — what `crossSite` gates on. */
const foreign = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { origin: "https://evil.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = { planner: await import("./settings/planner/route") };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("planner settings api", () => {
  it("defaults to nine to six on Monday through Friday, accepts a sane range, rejects the rest", async () => {
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "09:00-18:00", workingDays: [1, 2, 3, 4, 5] });
    const ok = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "08:30-17:00" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ workHours: "08:30-17:00", workingDays: [1, 2, 3, 4, 5] });
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "17:00-08:30" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "nine to five" }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { nope: 1 }))).status).toBe(400);
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "08:30-17:00", workingDays: [1, 2, 3, 4, 5] });
  });

  it("saves working days independently of working hours, and rejects a bad list", async () => {
    const ok = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: [6, 1, 1, 3] }));
    expect(ok.status).toBe(200);
    // Deduplicated and sorted; workHours from the previous test is untouched.
    expect(await ok.json()).toEqual({ workHours: "08:30-17:00", workingDays: [1, 3, 6] });
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: [] }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: [0, 1] }))).status).toBe(400);
    expect((await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: [1, 8] }))).status).toBe(400);
    // The bad patches above never landed.
    expect(await (await r.planner.GET()).json()).toEqual({ workHours: "08:30-17:00", workingDays: [1, 3, 6] });
  });

  it("accepts a list that only dedupes down to a valid one, longer than the number of ISO weekdays", async () => {
    // Eight repeats of one day: a length cap ahead of the dedupe would reject this even though
    // it collapses to a single, perfectly valid working day.
    const ok = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: Array(8).fill(1) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ workHours: "08:30-17:00", workingDays: [1] });
    // Restore Mon-Fri for the tests that follow.
    await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workingDays: [1, 2, 3, 4, 5] }));
  });

  it("validates every field before writing any of them: a good workHours beside a bad workingDays saves neither", async () => {
    const before = await (await r.planner.GET()).json();
    const res = await r.planner.PATCH(json("PATCH", "/api/settings/planner", { workHours: "07:00-15:00", workingDays: [0, 1] }));
    expect(res.status).toBe(400);
    // The valid half of the patch did not land just because the other half failed.
    expect(await (await r.planner.GET()).json()).toEqual(before);
  });

  it("is a no-op that still answers 200 with an empty patch", async () => {
    const before = await (await r.planner.GET()).json();
    const res = await r.planner.PATCH(json("PATCH", "/api/settings/planner", {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(before);
  });

  it("gates PATCH on the same-origin guard, the pre-existing gap this route was missing, and the write never happens", async () => {
    const before = await (await r.planner.GET()).json();
    const res = await r.planner.PATCH(foreign("PATCH", "/api/settings/planner", { workHours: "10:00-16:00", workingDays: [7] }));
    expect(res.status).toBe(403);
    // The point of the guard: not just the status code, but that nothing was actually saved.
    expect(await (await r.planner.GET()).json()).toEqual(before);
  });
});
