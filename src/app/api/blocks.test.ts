import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

const DAY = "2026-10-05";
/** The placement's own day, so nothing an earlier case left behind can sit in its slots. */
const PLACE_DAY = "2026-10-12";

let dir: string;
let r: {
  blocks: typeof import("./blocks/route");
  block: typeof import("./blocks/[id]/route");
  taskBlocks: typeof import("./tasks/[id]/blocks/route");
  place: typeof import("./plan/place/route");
  tasks: typeof import("./tasks/route");
  plan: typeof import("./plan/route");
};
const json = (method: string, url: string, body?: unknown) =>
  new Request(`http://localhost${url}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const params = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

/** A local date `n` days from today, for the window a task list carries its sessions in. */
function shift(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface BlockBody {
  id: number;
  taskId: number;
  startsAt: string;
  minutes: number;
}

async function addTask(title: string, over: Record<string, unknown> = {}): Promise<number> {
  return ((await (await r.tasks.POST(json("POST", "/api/tasks", { title, ...over }))).json()) as { id: number }).id;
}

async function addBlock(taskId: number, startsAt: string, minutes: number): Promise<BlockBody> {
  const res = await r.blocks.POST(json("POST", "/api/blocks", { taskId, startsAt, minutes }));
  expect(res.status).toBe(201);
  return (await res.json()) as BlockBody;
}

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    blocks: await import("./blocks/route"),
    block: await import("./blocks/[id]/route"),
    taskBlocks: await import("./tasks/[id]/blocks/route"),
    place: await import("./plan/place/route"),
    tasks: await import("./tasks/route"),
    plan: await import("./plan/route"),
  };
  // A meeting for the placement to work around, written through the calendar the app uses.
  const { getDb } = await import("@/db/client");
  const { replaceCalendarEvents } = await import("@/domain/activity");
  replaceCalendarEvents(getDb(), [
    { externalId: "m1", title: "Sync", startsAt: `${DAY}T10:00:00`, endsAt: `${DAY}T11:00:00`, attendees: 2, hasCallLink: true },
    { externalId: "m2", title: "Sync", startsAt: `${PLACE_DAY}T10:00:00`, endsAt: `${PLACE_DAY}T11:00:00`, attendees: 2, hasCallLink: true },
  ]);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("blocks api", () => {
  it("creates, moves, resizes and removes a session", async () => {
    const taskId = await addTask("Write the launch note", { estimateMinutes: 60 });
    const block = await addBlock(taskId, `${DAY}T09:00:00`, 45);
    expect(block).toEqual({ id: block.id, taskId, startsAt: `${DAY}T09:00:00`, minutes: 45 });

    const moved = await r.block.PATCH(json("PATCH", "/x", { startsAt: `${DAY}T11:30:00`, minutes: 30 }), params(block.id));
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({ id: block.id, taskId, startsAt: `${DAY}T11:30:00`, minutes: 30 });

    // The task carries its sessions wherever it is listed.
    const listed = (await (await r.tasks.GET(json("GET", "/api/tasks?status=open"))).json()) as { tasks: { id: number; blocks: BlockBody[] }[] };
    expect(listed.tasks.find((t) => t.id === taskId)!.blocks).toEqual([{ id: block.id, taskId, startsAt: `${DAY}T11:30:00`, minutes: 30 }]);

    expect((await r.block.DELETE(json("DELETE", "/x"), params(block.id))).status).toBe(204);
    expect((await r.block.DELETE(json("DELETE", "/x"), params(block.id))).status).toBe(404);
  });

  it("clears one day's sessions and leaves another day's alone", async () => {
    const taskId = await addTask("Draft the brief");
    await addBlock(taskId, `${DAY}T09:00:00`, 30);
    await addBlock(taskId, `${DAY}T14:00:00`, 30);
    // Inside the window a task list carries, whenever this runs.
    const other = await addBlock(taskId, `${shift(3)}T09:00:00`, 30);
    const cleared = await r.taskBlocks.DELETE(json("DELETE", `/api/tasks/${taskId}/blocks?date=${DAY}`), params(taskId));
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ removed: 2 });
    const after = (await (await r.tasks.GET(json("GET", "/api/tasks?status=open"))).json()) as { tasks: { id: number; blocks: BlockBody[] }[] };
    expect(after.tasks.find((t) => t.id === taskId)!.blocks.map((b) => b.id)).toEqual([other.id]);
  });

  // Its own day and its own tasks: what the cases above placed or cleared cannot move these.
  it("places one task's sessions around the day's meeting, and fills the day", async () => {
    const taskId = await addTask("Long piece of work", { estimateMinutes: 120 });
    const placed = await r.place.POST(json("POST", "/api/plan/place", { date: PLACE_DAY, taskId }));
    expect(placed.status).toBe(200);
    // 09:00–09:45; the ten-minute break would leave only five minutes of the morning slot, so
    // the second session waits for the meeting to end (11:00–11:45) and the third takes its
    // break after it (11:55–12:25).
    expect(await placed.json()).toEqual({ placed: 3, unplacedMinutes: 0 });

    const waiting = await addTask("Waiting on the plan", { estimateMinutes: 45, sessionMinutes: 45 });
    await r.plan.POST(json("POST", "/api/plan", { date: PLACE_DAY, taskId: waiting }));
    const filled = await r.place.POST(json("POST", "/api/plan/place", { date: PLACE_DAY }));
    // 09:45–10:00 is all that is left before the meeting: the session takes it and carries the
    // rest past the morning's work, to 12:25.
    expect(await filled.json()).toEqual({ placed: 2, unplacedMinutes: 0 });
    const day = (await (await r.plan.GET(json("GET", `/api/plan?date=${PLACE_DAY}`))).json()) as { tasks: { id: number; blocks: BlockBody[]; sessionMinutes: number | null }[] };
    const row = day.tasks.find((t) => t.id === waiting)!;
    expect(row.sessionMinutes).toBe(45);
    expect(row.blocks.map((b) => [b.startsAt.slice(11, 16), b.minutes])).toEqual([["09:45", 15], ["12:25", 30]]);
  });

  it("carries the sessions near today and leaves an old one out of the payload", async () => {
    const taskId = await addTask("Long runner");
    // A month back is outside the window a list carries; three days ahead is inside it.
    await addBlock(taskId, `${shift(-30)}T09:00:00`, 30);
    const soon = await addBlock(taskId, `${shift(3)}T09:00:00`, 30);
    const listed = (await (await r.tasks.GET(json("GET", "/api/tasks?status=open"))).json()) as { tasks: { id: number; blocks: BlockBody[] }[] };
    expect(listed.tasks.find((t) => t.id === taskId)!.blocks.map((b) => b.id)).toEqual([soon.id]);
  });

  it("refuses a body it cannot read", async () => {
    const taskId = await addTask("Checks");
    expect((await r.blocks.POST(json("POST", "/api/blocks", { taskId, startsAt: `${DAY} 09:00`, minutes: 30 }))).status).toBe(400);
    expect((await r.blocks.POST(json("POST", "/api/blocks", { taskId, startsAt: `${DAY}T09:00:00`, minutes: 3 }))).status).toBe(400);
    expect((await r.blocks.POST(json("POST", "/api/blocks", { taskId, startsAt: `${DAY}T09:00:00`, minutes: 30, nope: 1 }))).status).toBe(400);
    expect((await r.blocks.POST(json("POST", "/api/blocks", { taskId: 9999, startsAt: `${DAY}T09:00:00`, minutes: 30 }))).status).toBe(404);
    expect((await r.block.PATCH(json("PATCH", "/x", { taskId: 2 }), params(1))).status).toBe(400);
    expect((await r.block.PATCH(json("PATCH", "/x", { minutes: 30 }), params(9999))).status).toBe(404);
    expect((await r.taskBlocks.DELETE(json("DELETE", `/api/tasks/${taskId}/blocks?date=nope`), params(taskId))).status).toBe(400);
    expect((await r.taskBlocks.DELETE(json("DELETE", `/api/tasks/${taskId}/blocks`), params(taskId))).status).toBe(400);
    expect((await r.place.POST(json("POST", "/api/plan/place", { date: "nope" }))).status).toBe(400);
    expect((await r.place.POST(json("POST", "/api/plan/place", { date: DAY, taskId: 9999 }))).status).toBe(404);
  });
});
