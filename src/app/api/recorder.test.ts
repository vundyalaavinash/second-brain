import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "@/db/client";
import { Recorder, setRecorder } from "@/domain/meetings";
import { makeTempDataDir } from "@/test/db";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_RECORDER = path.join(here, "..", "..", "test", "fake-recorder.js");

const ORIGIN = "http://localhost:3141";

let dir: string;
let r: {
  status: typeof import("./meetings/recorder/route");
  start: typeof import("./meetings/recorder/start/route");
  stop: typeof import("./meetings/recorder/stop/route");
  keep: typeof import("./meetings/recorder/keep/route");
};

/** A POST at the app's own address; `origin` null means a request that carries no Origin at all. */
const post = (url: string, origin: string | null) =>
  new Request(`${ORIGIN}${url}`, { method: "POST", headers: origin ? { origin } : undefined, body: "{}" });

beforeAll(async () => {
  dir = makeTempDataDir();
  r = {
    status: await import("./meetings/recorder/route"),
    start: await import("./meetings/recorder/start/route"),
    stop: await import("./meetings/recorder/stop/route"),
    keep: await import("./meetings/recorder/keep/route"),
  };
  // A controller the routes can reach without `checkTools` looking for the real helper. It is
  // never started: every request below is refused, or refused a target, before anything spawns.
  setRecorder(new Recorder({ db: getDb(), recorderBin: FAKE_RECORDER, whisperBin: null, baseModel: null, filesDir: path.join(dir, "files") }));
});
afterAll(() => {
  setRecorder(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the recorder routes", () => {
  it("refuses a post from another site: these three drive a local process", async () => {
    const evil = "https://evil.example";
    for (const res of [await r.start.POST(post("/api/meetings/recorder/start", evil)), await r.stop.POST(post("/api/meetings/recorder/stop", evil)), await r.keep.POST(post("/api/meetings/recorder/keep", evil))]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Forbidden" });
    }
  });

  it("lets the app's own pages through, with or without an Origin header", async () => {
    for (const origin of [ORIGIN, null]) {
      expect((await r.stop.POST(post("/api/meetings/recorder/stop", origin))).status).toBe(200);
      expect((await r.keep.POST(post("/api/meetings/recorder/keep", origin))).status).toBe(200);
      // No target in the body, so this is the 400 the controller gives, not the 403 of a stranger.
      expect((await r.start.POST(post("/api/meetings/recorder/start", origin))).status).toBe(400);
    }
  });

  it("answers the status read to anyone: it starts nothing", async () => {
    const res = await r.status.GET();
    expect(res.status).toBe(200);
    expect((await res.json()).state).toBe("idle");
  });
});
