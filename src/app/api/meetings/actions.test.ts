import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let actions: typeof import("./[id]/actions/route");

const json = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  actions = await import("./[id]/actions/route");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("meeting actions api", () => {
  it("makes one task per accepted action, even when the same index is posted twice", async () => {
    const { getDb } = await import("@/db/client");
    const { createItem, getItem, parseMeta } = await import("@/domain/items");
    const { listTasks } = await import("@/domain/tasks");
    const db = getDb();
    const meeting = createItem(db, {
      type: "meeting",
      title: "Sync",
      meta: { summary: { summary: "s", decisions: [], proposed_actions: [{ title: "Write the note", notes: "Ada offered" }] } },
    });

    const first = await actions.POST(json(`/api/meetings/${meeting.id}/actions`, { index: 0, title: "Write the note" }), params(meeting.id));
    expect(first.status).toBe(201);
    const again = await actions.POST(json(`/api/meetings/${meeting.id}/actions`, { index: 0, title: "Write the note" }), params(meeting.id));
    expect(again.status).toBe(200);

    const made = listTasks(db, { sourceItemId: meeting.id, status: "all" });
    expect(made).toHaveLength(1);
    expect(((await again.json()) as { task: { id: number } }).task.id).toBe(made[0].id);
    expect(parseMeta<{ acceptedActions: number[] }>(getItem(db, meeting.id)!).acceptedActions).toEqual([0]);

    expect((await actions.POST(json(`/api/meetings/${meeting.id}/actions`, { index: 4, title: "x" }), params(meeting.id))).status).toBe(404);
  });
});
