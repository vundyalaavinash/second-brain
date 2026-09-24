import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";
import type { FocusRunDTO, FocusSettingsDTO, FocusSummaryDTO } from "@/lib/dto";

let dir: string;
let r: {
  focus: typeof import("./focus/route");
  focusId: typeof import("./focus/[id]/route");
  summary: typeof import("./focus/summary/route");
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

async function newTask(title: string): Promise<number> {
  const res = await r.tasks.POST(json("POST", "/api/tasks", { title }));
  const { id } = (await res.json()) as { id: number };
  return id;
}

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    focus: await import("./focus/route"),
    focusId: await import("./focus/[id]/route"),
    summary: await import("./focus/summary/route"),
    tasks: await import("./tasks/route"),
  };
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.useRealTimers());

describe("focus api", () => {
  it("starts a run, reads it back from GET, finishes it, and books the minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T09:00:00.000Z"));

    const taskId = await newTask("Draft the brief");
    const started = await r.focus.POST(json("POST", "/api/focus", { taskId, minutes: 45 }));
    expect(started.status).toBe(201);
    const run = (await started.json()) as FocusRunDTO;
    expect(run).toMatchObject({ taskId, taskTitle: "Draft the brief", plannedMinutes: 45, outcome: null });

    const state = (await (await r.focus.GET()).json()) as { run: FocusRunDTO | null; settings: FocusSettingsDTO; completedToday: number };
    expect(state.run?.id).toBe(run.id);
    expect(state.settings.defaultMinutes).toBe(25);
    expect(state.completedToday).toBe(0);

    vi.setSystemTime(new Date("2026-09-24T09:20:00.000Z"));
    const finished = await r.focusId.PATCH(json("PATCH", `/api/focus/${run.id}`, { outcome: "stopped" }), { params: Promise.resolve({ id: String(run.id) }) });
    expect(finished.status).toBe(200);
    const body = (await finished.json()) as { run: FocusRunDTO; where: { label: string; ms: number }[] };
    expect(body.run).toMatchObject({ outcome: "stopped", actualMinutes: 20 });
    expect(body.where).toEqual([]);

    expect(((await (await r.focus.GET()).json()) as { run: FocusRunDTO | null }).run).toBeNull();
  });

  it("starting a second run stops the first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T09:00:00.000Z"));
    const a = await newTask("A");
    const b = await newTask("B");
    const first = (await (await r.focus.POST(json("POST", "/api/focus", { taskId: a, minutes: 45 }))).json()) as FocusRunDTO;

    vi.setSystemTime(new Date("2026-09-27T09:30:00.000Z"));
    const second = (await (await r.focus.POST(json("POST", "/api/focus", { taskId: b, minutes: 25 }))).json()) as FocusRunDTO;
    expect(second.taskId).toBe(b);

    const state = (await (await r.focus.GET()).json()) as { run: FocusRunDTO | null };
    expect(state.run?.id).toBe(second.id);

    // The first run was stopped automatically, not left dangling: it is already finished, so
    // finishing it again 400s rather than silently re-closing it.
    const already = await r.focusId.PATCH(json("PATCH", `/api/focus/${first.id}`, { outcome: "stopped" }), { params: Promise.resolve({ id: String(first.id) }) });
    expect(already.status).toBe(400);

    vi.setSystemTime(new Date("2026-09-27T09:50:00.000Z"));
    await r.focusId.PATCH(json("PATCH", `/api/focus/${second.id}`, { outcome: "completed" }), { params: Promise.resolve({ id: String(second.id) }) });

    const s = (await (await r.summary.GET(json("GET", "/api/focus/summary?from=2026-09-27&to=2026-09-28"))).json()) as FocusSummaryDTO;
    expect(s.byTask.find((x) => x.taskId === a)?.minutes).toBe(30);
    expect(s.byTask.find((x) => x.taskId === b)?.minutes).toBe(20);
  });

  it("answers a range summary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T09:00:00.000Z"));
    const taskId = await newTask("Draft the brief");
    const run = (await (await r.focus.POST(json("POST", "/api/focus", { taskId, minutes: 25 }))).json()) as FocusRunDTO;
    vi.setSystemTime(new Date("2026-09-28T09:25:00.000Z"));
    await r.focusId.PATCH(json("PATCH", `/api/focus/${run.id}`, { outcome: "completed" }), { params: Promise.resolve({ id: String(run.id) }) });

    const res = await r.summary.GET(json("GET", "/api/focus/summary?from=2026-09-28&to=2026-09-29"));
    expect(res.status).toBe(200);
    const s = (await res.json()) as FocusSummaryDTO;
    expect(s).toMatchObject({ minutes: 25, runs: 1 });
    expect(s.byTask).toEqual([{ taskId, title: "Draft the brief", minutes: 25, runs: 1 }]);
  });

  it("rejects a summary query missing from/to", async () => {
    expect((await r.summary.GET(json("GET", "/api/focus/summary"))).status).toBe(400);
    expect((await r.summary.GET(json("GET", "/api/focus/summary?from=2026-09-24"))).status).toBe(400);
    expect((await r.summary.GET(json("GET", "/api/focus/summary?from=not-a-date&to=2026-09-25"))).status).toBe(400);
  });

  it("answers 400, not 500, for a body that is not JSON at all", async () => {
    const notJson = new Request("http://localhost/api/focus", { method: "POST", headers: { "content-type": "application/json" }, body: "not json" });
    expect((await r.focus.POST(notJson)).status).toBe(400);
    const noBody = new Request("http://localhost/api/focus", { method: "POST" });
    expect((await r.focus.POST(noBody)).status).toBe(400);
    const noBodyPatch = new Request("http://localhost/api/focus/1", { method: "PATCH" });
    expect((await r.focusId.PATCH(noBodyPatch, { params: Promise.resolve({ id: "1" }) })).status).toBe(400);
  });

  it("rejects a bad body: an unknown outcome, an out-of-range minutes, and a missing taskId", async () => {
    const taskId = await newTask("Draft the brief");
    expect((await r.focus.POST(json("POST", "/api/focus", { taskId, minutes: 4 }))).status).toBe(400);
    expect((await r.focus.POST(json("POST", "/api/focus", {}))).status).toBe(400);
    const run = (await (await r.focus.POST(json("POST", "/api/focus", { taskId, minutes: 25 }))).json()) as FocusRunDTO;
    expect(
      (await r.focusId.PATCH(json("PATCH", `/api/focus/${run.id}`, { outcome: "bogus" }), { params: Promise.resolve({ id: String(run.id) }) })).status,
    ).toBe(400);
    // Leaves nothing live for later tests.
    await r.focusId.PATCH(json("PATCH", `/api/focus/${run.id}`, { outcome: "stopped" }), { params: Promise.resolve({ id: String(run.id) }) });
  });

  it("404s finishing a run that does not exist", async () => {
    const res = await r.focusId.PATCH(json("PATCH", "/api/focus/9999", { outcome: "stopped" }), { params: Promise.resolve({ id: "9999" }) });
    expect(res.status).toBe(404);
  });

  it("gates POST and PATCH on the same-origin guard", async () => {
    expect((await r.focus.POST(foreign("POST", "/api/focus", { taskId: 1, minutes: 25 }))).status).toBe(403);
    expect((await r.focusId.PATCH(foreign("PATCH", "/api/focus/1", { outcome: "stopped" }), { params: Promise.resolve({ id: "1" }) })).status).toBe(403);
  });
});
