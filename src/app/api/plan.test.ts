import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: {
  plan: typeof import("./plan/route");
  carryOver: typeof import("./plan/carry-over/route");
  tasks: typeof import("./tasks/route");
  task: typeof import("./tasks/[id]/route");
};
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function addTask(title: string): Promise<number> {
  const res = await r.tasks.POST(json("POST", "/api/tasks", { title }));
  return ((await res.json()) as { id: number }).id;
}

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    plan: await import("./plan/route"),
    carryOver: await import("./plan/carry-over/route"),
    tasks: await import("./tasks/route"),
    task: await import("./tasks/[id]/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("plan api", () => {
  it("plans, reorders, carries over, and removes", async () => {
    const a = await addTask("Draft email");
    const b = await addTask("Pick tool");
    expect((await r.plan.POST(json("POST", "/api/plan", { date: "2026-09-21", taskId: a }))).status).toBe(201);
    await r.plan.POST(json("POST", "/api/plan", { date: "2026-09-21", taskId: b }));

    const listed = (await (await r.plan.GET(json("GET", "/api/plan?date=2026-09-21"))).json()) as {
      date: string;
      tasks: { id: number; planId: number; sortOrder: number }[];
      unfinishedYesterday: { id: number }[];
    };
    expect(listed.date).toBe("2026-09-21");
    expect(listed.tasks.map((t) => [t.id, t.sortOrder])).toEqual([
      [a, 0],
      [b, 1],
    ]);
    expect(listed.tasks.every((t) => t.planId > 0)).toBe(true);
    expect(listed.unfinishedYesterday).toEqual([]);

    const reordered = (await (await r.plan.PATCH(json("PATCH", "/api/plan", { date: "2026-09-21", taskIds: [b, a] }))).json()) as { tasks: { id: number }[] };
    expect(reordered.tasks.map((t) => t.id)).toEqual([b, a]);

    await r.task.PATCH(json("PATCH", "/x", { status: "done" }), params(b));
    const moved = (await (await r.carryOver.POST(json("POST", "/api/plan/carry-over", { from: "2026-09-21", to: "2026-09-22" }))).json()) as { moved: number };
    expect(moved).toEqual({ moved: 1 });

    const next = (await (await r.plan.GET(json("GET", "/api/plan?date=2026-09-22"))).json()) as { tasks: { id: number }[]; unfinishedYesterday: { id: number }[] };
    expect(next.tasks.map((t) => t.id)).toEqual([a]);
    expect(next.unfinishedYesterday.map((t) => t.id)).toEqual([a]);

    const after = (await (await r.plan.DELETE(json("DELETE", "/api/plan", { date: "2026-09-22", taskId: a }))).json()) as { tasks: unknown[] };
    expect(after.tasks).toEqual([]);
  });

  it("rejects a bad date, a bad body, and an unknown task", async () => {
    expect((await r.plan.GET(json("GET", "/api/plan"))).status).toBe(400);
    expect((await r.plan.GET(json("GET", "/api/plan?date=nope"))).status).toBe(400);
    expect((await r.plan.POST(json("POST", "/api/plan", { date: "2026-09-21" }))).status).toBe(400);
    expect((await r.plan.PATCH(json("PATCH", "/api/plan", { date: "2026-09-21", taskIds: [0] }))).status).toBe(400);
    expect((await r.carryOver.POST(json("POST", "/api/plan/carry-over", { from: "nope", to: "2026-09-22" }))).status).toBe(400);
    expect((await r.plan.POST(json("POST", "/api/plan", { date: "2026-09-21", taskId: 999 }))).status).toBe(404);
  });
});
