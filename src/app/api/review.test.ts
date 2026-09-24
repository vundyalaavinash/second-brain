import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { listPlan } from "@/domain/plan";
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

  it("defaults to the current week when none is given", async () => {
    const res = await r.review.GET(json("GET", "/api/review"));
    expect(res.status).toBe(200);
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

  it("gates PATCH and POST on the same-origin guard", async () => {
    expect((await r.review.PATCH(foreign("PATCH", "/api/review", { week: WEEK, step: "clear", value: "x" }))).status).toBe(403);
    expect((await r.plan.POST(foreign("POST", "/api/review/plan", { week: WEEK, taskIds: [] }))).status).toBe(403);
  });
});
