import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import type { GoalDTO } from "@/lib/dto";

let dir: string;
let r: {
  goals: typeof import("./goals/route");
  goal: typeof import("./goals/[id]/route");
  links: typeof import("./goals/[id]/links/route");
  containers: typeof import("./containers/route");
  tasks: typeof import("./tasks/route");
  task: typeof import("./tasks/[id]/route");
};

const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    goals: await import("./goals/route"),
    goal: await import("./goals/[id]/route"),
    links: await import("./goals/[id]/links/route"),
    containers: await import("./containers/route"),
    tasks: await import("./tasks/route"),
    task: await import("./tasks/[id]/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("goals api", () => {
  it("creates, lists with a measure, links containers and closes", async () => {
    const made = await r.goals.POST(json("POST", "/api/goals", { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" }));
    expect(made.status).toBe(201);
    const goal = (await made.json()) as GoalDTO;
    expect(goal.measure).toMatchObject({ total: 0, stalled: true });

    const project = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Ship the API" }));
    const { id: containerId } = (await project.json()) as { id: number };
    const linked = await r.links.PUT(json("PUT", `/api/goals/${goal.id}/links`, { containerIds: [containerId] }), { params: Promise.resolve({ id: String(goal.id) }) });
    expect(linked.status).toBe(200);

    const task = await r.tasks.POST(json("POST", "/api/tasks", { title: "one", containerId }));
    const { id: taskId } = (await task.json()) as { id: number };
    await r.task.PATCH(json("PATCH", `/api/tasks/${taskId}`, { status: "done" }), { params: Promise.resolve({ id: String(taskId) }) });

    const list = (await (await r.goals.GET(json("GET", "/api/goals"))).json()) as { goals: GoalDTO[] };
    expect(list.goals[0].measure).toMatchObject({ done: 1, total: 1, percent: 100, movement: 1, stalled: false });

    const closed = await r.goal.PATCH(json("PATCH", `/api/goals/${goal.id}`, { status: "hit" }), { params: Promise.resolve({ id: String(goal.id) }) });
    expect(((await closed.json()) as GoalDTO).status).toBe("hit");
  });

  it("refuses a body it does not recognise", async () => {
    const res = await r.goals.POST(json("POST", "/api/goals", { title: "x", horizon: "week", targetDate: "2026-12-31" }));
    expect(res.status).toBe(400);
  });

  it("answers 404 for a goal that is not there", async () => {
    const res = await r.goal.GET(json("GET", "/api/goals/9999"), { params: Promise.resolve({ id: "9999" }) });
    expect(res.status).toBe(404);
  });
});
