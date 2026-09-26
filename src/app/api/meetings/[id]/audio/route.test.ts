import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeTempDataDir } from "@/test/db";

let dir: string;
let audio: typeof import("./route");

const del = (url: string, origin?: string) => new Request(`http://localhost${url}`, { method: "DELETE", headers: origin ? { origin } : undefined });
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });

beforeAll(async () => {
  dir = makeTempDataDir();
  audio = await import("./route");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("DELETE /api/meetings/[id]/audio", () => {
  it("removes the audio for a meeting whose transcript is good, and keeps the transcript", async () => {
    const { getDb } = await import("@/db/client");
    const { createItem, getItem, parseMeta, updateItem } = await import("@/domain/items");
    const db = getDb();
    const wavPath = "meetings/good.wav";
    const meeting = createItem(db, {
      type: "meeting",
      title: "Sync",
      meta: { recording: { startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:00.000Z", wavPath, state: "done", autoStarted: false } },
    });
    updateItem(db, meeting.id, { extractedText: "we agreed to ship on Friday" });
    const file = path.join(dir, "files", wavPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(1000));

    const res = await audio.DELETE(del(`/api/meetings/${meeting.id}/audio`), params(meeting.id));
    expect(res.status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
    const after = getItem(db, meeting.id)!;
    expect(after.extractedText).toContain("ship on Friday");
    expect(parseMeta<{ audioReleasedAt?: string }>(after).audioReleasedAt).toBeTruthy();

    // finding 4: this action refreshes the status line's snapshot immediately, rather than
    // leaving it to lag until the next nightly pass.
    const { readAudioFootprintSnapshot } = await import("@/domain/meetings/audio-retention");
    expect(readAudioFootprintSnapshot(db)).toEqual({ recordings: 0, bytes: 0, nextReleaseAt: null });
  });

  it("refuses a meeting with no transcript -- the rule that cannot be broken", async () => {
    const { getDb } = await import("@/db/client");
    const { createItem } = await import("@/domain/items");
    const db = getDb();
    const wavPath = "meetings/untranscribed.wav";
    const meeting = createItem(db, {
      type: "meeting",
      title: "No transcript yet",
      meta: { recording: { startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:00.000Z", wavPath, state: "done", autoStarted: false } },
    });
    const file = path.join(dir, "files", wavPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(1000));

    const res = await audio.DELETE(del(`/api/meetings/${meeting.id}/audio`), params(meeting.id));
    expect(res.status).toBe(409);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("404s for an item that does not exist, and 400s for a non-meeting item", async () => {
    const { getDb } = await import("@/db/client");
    const { createItem } = await import("@/domain/items");
    const db = getDb();

    expect((await audio.DELETE(del("/api/meetings/999999/audio"), params(999999))).status).toBe(404);

    const note = createItem(db, { type: "note", title: "Just a note" });
    expect((await audio.DELETE(del(`/api/meetings/${note.id}/audio`), params(note.id))).status).toBe(400);
  });

  it("gates on the same-origin guard, and the file survives", async () => {
    const { getDb } = await import("@/db/client");
    const { createItem, updateItem } = await import("@/domain/items");
    const db = getDb();
    const wavPath = "meetings/foreign.wav";
    const meeting = createItem(db, {
      type: "meeting",
      title: "Gated",
      meta: { recording: { startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:00.000Z", wavPath, state: "done", autoStarted: false } },
    });
    updateItem(db, meeting.id, { extractedText: "notes" });
    const file = path.join(dir, "files", wavPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(10));

    const res = await audio.DELETE(del(`/api/meetings/${meeting.id}/audio`, "https://evil.example"), params(meeting.id));
    expect(res.status).toBe(403);
    expect(fs.existsSync(file)).toBe(true);
  });
});
