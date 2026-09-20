import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let r: {
  tasks: typeof import("./tasks/route");
  task: typeof import("./tasks/[id]/route");
  reorder: typeof import("./tasks/reorder/route");
  containers: typeof import("./containers/route");
  container: typeof import("./containers/[id]/route");
  archive: typeof import("./containers/[id]/archive/route");
};
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    tasks: await import("./tasks/route"),
    task: await import("./tasks/[id]/route"),
    reorder: await import("./tasks/reorder/route"),
    containers: await import("./containers/route"),
    container: await import("./containers/[id]/route"),
    archive: await import("./containers/[id]/archive/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("tasks api", () => {
  let projectId: number;

  it("creates, lists with progress, patches, and rejects bad input", async () => {
    const created = await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Launch" }));
    projectId = ((await created.json()) as { id: number }).id;
    const a = await r.tasks.POST(json("POST", "/api/tasks", { title: "Draft email", containerId: projectId, dueDate: "2026-09-20" }));
    expect(a.status).toBe(201);
    const aId = ((await a.json()) as { id: number }).id;
    await r.tasks.POST(json("POST", "/api/tasks", { title: "Pick tool", containerId: projectId }));
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "", containerId: projectId }))).status).toBe(400);
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "x", dueDate: "nope" }))).status).toBe(400);
    expect((await r.tasks.POST(json("POST", "/api/tasks", { title: "x", containerId: 999 }))).status).toBe(404);
    const list = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}`))).json()) as { tasks: { id: number }[]; progress: { open: number; percent: number } };
    expect(list.tasks).toHaveLength(2);
    expect(list.progress).toMatchObject({ open: 2, percent: 0 });
    const done = await r.task.PATCH(json("PATCH", "/x", { status: "done", priority: "high" }), params(aId));
    expect((await done.json()) as { status: string; priority: string }).toMatchObject({ status: "done", priority: "high" });
    const after = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}&status=all`))).json()) as { progress: { done: number; percent: number } };
    expect(after.progress).toMatchObject({ done: 1, percent: 50 });
    expect((await r.task.PATCH(json("PATCH", "/x", { status: "weird" }), params(aId))).status).toBe(400);
    expect((await r.task.PATCH(json("PATCH", "/x", { title: "y" }), params(999))).status).toBe(404);
    expect((await r.task.PATCH(json("PATCH", "/x", { sourceItemId: 1 }), params(aId))).status).toBe(400);
  });

  it("reorders, exposes progress on the container DTO, and rejects nextSteps", async () => {
    const list = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${projectId}`))).json()) as { tasks: { id: number; title: string }[] };
    const extra = await r.tasks.POST(json("POST", "/api/tasks", { title: "Import contacts", containerId: projectId }));
    const extraId = ((await extra.json()) as { id: number }).id;
    const re = await r.reorder.POST(json("POST", "/api/tasks/reorder", { containerId: projectId, ids: [extraId, list.tasks[0].id] }));
    expect(((await re.json()) as { tasks: { id: number }[] }).tasks.map((t) => t.id)[0]).toBe(extraId);
    const c = (await (await r.container.GET(json("GET", "/x"), params(projectId))).json()) as { progress: { open: number; done: number; nextTask: { id: number } } };
    expect(c.progress).toMatchObject({ open: 2, done: 1 });
    expect(c.progress.nextTask.id).toBe(extraId);
    expect((await r.container.PATCH(json("PATCH", "/x", { nextSteps: "- [ ] x" }), params(projectId))).status).toBe(400);
  });

  it("archiving a project drops or moves its open tasks", async () => {
    const other = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "area", name: "Home" }))).json()) as { id: number }).id;
    const p2 = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Second" }))).json()) as { id: number }).id;
    const t1 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "Move me", containerId: p2 }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x", { moveItemsTo: other }), params(p2));
    const moved = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${other}`))).json()) as { tasks: { id: number }[] };
    expect(moved.tasks.map((t) => t.id)).toContain(t1);
    const p3 = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Third" }))).json()) as { id: number }).id;
    const t2 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "Drop me", containerId: p3 }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x"), params(p3));
    const dropped = (await (await r.tasks.GET(json("GET", `/api/tasks?container=${p3}&status=dropped`))).json()) as { tasks: { id: number }[] };
    expect(dropped.tasks.map((t) => t.id)).toEqual([t2]);
    const inboxMove = ((await (await r.containers.POST(json("POST", "/api/containers", { kind: "project", name: "Fourth" }))).json()) as { id: number }).id;
    const t3 = ((await (await r.tasks.POST(json("POST", "/api/tasks", { title: "To inbox", containerId: inboxMove }))).json()) as { id: number }).id;
    await r.archive.POST(json("POST", "/x", { moveItemsTo: null }), params(inboxMove));
    const inbox = (await (await r.tasks.GET(json("GET", "/api/tasks?container=inbox"))).json()) as { tasks: { id: number }[] };
    expect(inbox.tasks.map((t) => t.id)).toContain(t3);
    expect((await r.task.DELETE(json("DELETE", "/x"), params(t3))).status).toBe(204);
  });
});
