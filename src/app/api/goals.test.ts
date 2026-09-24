import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import type { GoalDTO, TaskDTO } from "@/lib/dto";

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

/** The same request as `json`, but from a page on another origin — what `crossSite` gates on. */
const foreign = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { origin: "https://evil.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

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

  it("a task carries the goals its project serves, and drops them when the goal closes", async () => {
    const made = await r.goals.POST(json("POST", "/api/goals", { title: "Launch v2", horizon: "quarter", targetDate: "2026-12-31" }));
    const goal = (await made.json()) as GoalDTO;
    const goalId = goal.id;

    const project = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Carry the goal" }));
    const { id: containerId } = (await project.json()) as { id: number };
    await r.links.PUT(json("PUT", `/api/goals/${goal.id}/links`, { containerIds: [containerId] }), { params: Promise.resolve({ id: String(goal.id) }) });

    await r.tasks.POST(json("POST", "/api/tasks", { title: "one", containerId }));

    const list = (await (await r.tasks.GET(json("GET", "/api/tasks"))).json()) as { tasks: TaskDTO[] };
    expect(list.tasks[0].goals).toEqual([{ id: goalId, title: "Launch v2" }]);

    await r.goal.PATCH(json("PATCH", `/api/goals/${goal.id}`, { status: "hit" }), { params: Promise.resolve({ id: String(goal.id) }) });

    const after = (await (await r.tasks.GET(json("GET", "/api/tasks"))).json()) as { tasks: TaskDTO[] };
    expect(after.tasks[0].goals).toEqual([]);
  });

  it("refuses a body it does not recognise", async () => {
    const res = await r.goals.POST(json("POST", "/api/goals", { title: "x", horizon: "week", targetDate: "2026-12-31" }));
    expect(res.status).toBe(400);
  });

  it("answers 404 for a goal that is not there", async () => {
    const res = await r.goal.GET(json("GET", "/api/goals/9999"), { params: Promise.resolve({ id: "9999" }) });
    expect(res.status).toBe(404);
  });

  it("answers 400, not 500, for a body that is not JSON at all", async () => {
    const notJson = new Request("http://localhost/api/goals", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    expect((await r.goals.POST(notJson)).status).toBe(400);
    const noBody = new Request("http://localhost/api/goals", { method: "POST" });
    expect((await r.goals.POST(noBody)).status).toBe(400);
    const noBodyPatch = new Request("http://localhost/api/goals/1", { method: "PATCH" });
    expect((await r.goal.PATCH(noBodyPatch, { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
  });

  it("gates POST, PATCH, DELETE and PUT on the same-origin guard", async () => {
    expect((await r.goals.POST(foreign("POST", "/api/goals", { title: "x", horizon: "quarter", targetDate: "2026-12-31" }))).status).toBe(403);
    expect((await r.goal.PATCH(foreign("PATCH", "/api/goals/1", { status: "hit" }), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
    expect((await r.goal.DELETE(foreign("DELETE", "/api/goals/1"), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
    expect((await r.links.PUT(foreign("PUT", "/api/goals/1/links", { containerIds: [] }), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
  });

  it("deletes a goal, its links cascading with it", async () => {
    const made = await r.goals.POST(json("POST", "/api/goals", { title: "Temp", horizon: "quarter", targetDate: "2026-12-31" }));
    const goal = (await made.json()) as GoalDTO;
    const project = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Temp project" }));
    const { id: containerId } = (await project.json()) as { id: number };
    await r.links.PUT(json("PUT", `/api/goals/${goal.id}/links`, { containerIds: [containerId] }), { params: Promise.resolve({ id: String(goal.id) }) });

    const deleted = await r.goal.DELETE(json("DELETE", `/api/goals/${goal.id}`), { params: Promise.resolve({ id: String(goal.id) }) });
    expect(deleted.status).toBe(204);
    expect((await r.goal.GET(json("GET", `/api/goals/${goal.id}`), { params: Promise.resolve({ id: String(goal.id) }) })).status).toBe(404);
  });

  it("refuses linking a container that does not exist", async () => {
    const made = await r.goals.POST(json("POST", "/api/goals", { title: "Temp2", horizon: "quarter", targetDate: "2026-12-31" }));
    const goal = (await made.json()) as GoalDTO;
    const res = await r.links.PUT(json("PUT", `/api/goals/${goal.id}/links`, { containerIds: [999999] }), { params: Promise.resolve({ id: String(goal.id) }) });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown ?status= rather than answering an empty list", async () => {
    const res = await r.goals.GET(json("GET", "/api/goals?status=bogus"));
    expect(res.status).toBe(400);
  });
});
