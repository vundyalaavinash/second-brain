import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { getReview, reviewSnapshot } from "@/domain/review";
import { listPlan } from "@/domain/plan";
import { localDay } from "@/domain/activity";
import { weekStart } from "@/lib/week";
import type { ReviewDTO } from "@/lib/dto";

let dir: string;
let r: {
  review: typeof import("./review/route");
  plan: typeof import("./review/plan/route");
  tasks: typeof import("./tasks/route");
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

/** The same request as `json`, but from a page on another origin — what `crossSite` gates on. */
const foreign = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { origin: "https://evil.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const WEEK = "2026-09-21"; // Monday
const NEXT_WEEK = "2026-09-28";

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    review: await import("./review/route"),
    plan: await import("./review/plan/route"),
    tasks: await import("./tasks/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("review api", () => {
  it("saves a step through PATCH and reads it back through GET", async () => {
    const saved = await r.review.PATCH(json("PATCH", "/api/review", { week: WEEK, step: "clear", value: "Cleared the inbox out." }));
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as ReviewDTO;
    expect(savedBody.answers.clear).toBe("Cleared the inbox out.");
    expect(savedBody.savedAt).not.toBeNull();

    const read = await r.review.GET(json("GET", `/api/review?week=${WEEK}`));
    expect(read.status).toBe(200);
    const readBody = (await read.json()) as ReviewDTO;
    expect(readBody.answers.clear).toBe("Cleared the inbox out.");
    expect(readBody.week).toBe(WEEK);
  });

  it("saves the goals step's record-shaped value, keyed by goal id — the whole reason SaveReviewBody is a discriminated union", async () => {
    const week = "2026-11-09"; // untouched by every other test in this file
    const res = await r.review.PATCH(json("PATCH", "/api/review", { week, step: "goals", value: { "7": "On track", "12": "Stalled" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDTO;
    expect(body.answers.goals).toEqual({ "7": "On track", "12": "Stalled" });

    const read = (await (await r.review.GET(json("GET", `/api/review?week=${week}`))).json()) as ReviewDTO;
    expect(read.answers.goals).toEqual({ "7": "On track", "12": "Stalled" });
  });

  it("rejects a string value for the goals step — the discriminant the union exists for", async () => {
    const res = await r.review.PATCH(json("PATCH", "/api/review", { week: "2026-11-09", step: "goals", value: "not a record" }));
    expect(res.status).toBe(400);
  });

  it("plans two tasks into next week and lands them on that Monday's plan", async () => {
    const t1 = await r.tasks.POST(json("POST", "/api/tasks", { title: "Draft the doc" }));
    const { id: id1 } = (await t1.json()) as { id: number };
    const t2 = await r.tasks.POST(json("POST", "/api/tasks", { title: "Ship it" }));
    const { id: id2 } = (await t2.json()) as { id: number };

    const planned = await r.plan.POST(json("POST", "/api/review/plan", { week: NEXT_WEEK, taskIds: [id1, id2] }));
    expect(planned.status).toBe(200);
    expect(await planned.json()).toEqual({ planned: 2 });

    const ids = listPlan(getDb(), NEXT_WEEK).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([id1, id2]));
  });

  it("counts a duplicate id once", async () => {
    const t = await r.tasks.POST(json("POST", "/api/tasks", { title: "Only once" }));
    const { id } = (await t.json()) as { id: number };
    const res = await r.plan.POST(json("POST", "/api/review/plan", { week: NEXT_WEEK, taskIds: [id, id, id] }));
    expect(await res.json()).toEqual({ planned: 1 });
  });

  it("normalizes PATCH's week to that week's Monday, so a mid-week date cannot open a second item GET can never read back", async () => {
    const midweek = "2026-09-23"; // Wednesday of WEEK
    const res = await r.review.PATCH(json("PATCH", "/api/review", { week: midweek, step: "clear", value: "Mid-week save." }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as ReviewDTO).week).toBe(WEEK);
    const read = (await (await r.review.GET(json("GET", `/api/review?week=${WEEK}`))).json()) as ReviewDTO;
    expect(read.answers.clear).toBe("Mid-week save.");
  });

  it("normalizes the plan route's week to Monday too, matching its own docstring", async () => {
    const t = await r.tasks.POST(json("POST", "/api/tasks", { title: "Normalize me" }));
    const { id } = (await t.json()) as { id: number };
    await r.plan.POST(json("POST", "/api/review/plan", { week: "2026-09-30", taskIds: [id] })); // Wednesday of NEXT_WEEK
    expect(listPlan(getDb(), NEXT_WEEK).map((x) => x.id)).toContain(id);
  });

  it("freezes a snapshot of the week's figures on every save — §5.2's record, not only the answer", async () => {
    const week = "2026-11-02"; // untouched by every other test in this file
    await r.review.PATCH(json("PATCH", "/api/review", { week, step: "clear", value: "Cleared." }));
    const item = getReview(getDb(), week);
    expect(item).toBeDefined();
    expect(reviewSnapshot(item!)).toEqual({ done: 0, dropped: 0, slipped: 0, focusMinutes: 0, focusRuns: 0, meetings: 0, projects: [] });
  });

  it("defaults to the current week when none is given — the week actually named, not merely a 200", async () => {
    const res = await r.review.GET(json("GET", "/api/review"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDTO;
    expect(body.week).toBe(weekStart(localDay(new Date().toISOString())));
  });

  it("a review nothing has been saved to has nothing to call saved", async () => {
    const res = await r.review.GET(json("GET", "/api/review?week=2026-10-05"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReviewDTO;
    expect(body.savedAt).toBeNull();
  });

  it("answers 400, not 500, for a body that is not JSON at all", async () => {
    const notJson = new Request("http://localhost/api/review", { method: "PATCH", headers: { "content-type": "application/json" }, body: "not json" });
    expect((await r.review.PATCH(notJson)).status).toBe(400);
    const noBody = new Request("http://localhost/api/review", { method: "PATCH" });
    expect((await r.review.PATCH(noBody)).status).toBe(400);
    const noPlanBody = new Request("http://localhost/api/review/plan", { method: "POST" });
    expect((await r.plan.POST(noPlanBody)).status).toBe(400);
  });

  it("rejects a malformed week", async () => {
    const bad = await r.review.GET(json("GET", "/api/review?week=not-a-date"));
    expect(bad.status).toBe(400);
  });

  it("rejects a date that matches the shape but is not a real calendar date, on all three routes", async () => {
    // The regex `DateString` accepts sees a well-formed YYYY-MM-DD; `new Date` would roll
    // 2026-13-45 over into 2027-02-08 rather than reject it, and these routes write a
    // permanent record keyed by whatever week they are given.
    expect((await r.review.GET(json("GET", "/api/review?week=2026-13-45"))).status).toBe(400);
    expect((await r.review.PATCH(json("PATCH", "/api/review", { week: "2026-13-45", step: "clear", value: "x" }))).status).toBe(400);
    expect((await r.plan.POST(json("POST", "/api/review/plan", { week: "2026-13-45", taskIds: [] }))).status).toBe(400);
  });

  it("gates PATCH and POST on the same-origin guard", async () => {
    expect((await r.review.PATCH(foreign("PATCH", "/api/review", { week: WEEK, step: "clear", value: "x" }))).status).toBe(403);
    expect((await r.plan.POST(foreign("POST", "/api/review/plan", { week: WEEK, taskIds: [] }))).status).toBe(403);
  });
});
