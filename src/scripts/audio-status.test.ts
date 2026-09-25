import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { openDatabase, type DB } from "@/db/client";
import { makeTempDataDir } from "@/test/db";
import { createItem, updateItem } from "@/domain/items";
import type { RecordingMeta } from "@/domain/meetings/recorder";

const REPO_ROOT = path.resolve(__dirname, "../..");
function runAudioStatus(dataDir: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", "src/scripts/audio-status.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, SB_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("audio-status.ts CLI", () => {
  let dataDir: string;
  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports a real error when there is no database yet", () => {
    dataDir = makeTempDataDir();
    const { status, stderr } = runAudioStatus(dataDir);
    expect(status).toBe(1);
    expect(stderr).toContain("no database at");
  });

  it("says so when nothing is held", () => {
    dataDir = makeTempDataDir();
    openDatabase(path.join(dataDir, "brain.db")).$client.close();

    const { status, stdout } = runAudioStatus(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("no audio held");
  });

  it("reports how many recordings, how much space, and when the next release is due, without writing anything", () => {
    dataDir = makeTempDataDir();
    const file = path.join(dataDir, "brain.db");
    const db: DB = openDatabase(file);
    const wavPath = "meetings/standup.wav";
    const recording: RecordingMeta = { startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:00.000Z", wavPath, state: "done", autoStarted: false };
    const item = createItem(db, { type: "meeting", title: "Standup", status: "ready", meta: { recording } });
    updateItem(db, item.id, { extractedText: "what was said" });
    db.$client.close();

    const wavFile = path.join(dataDir, "files", wavPath);
    fs.mkdirSync(path.dirname(wavFile), { recursive: true });
    fs.writeFileSync(wavFile, Buffer.alloc(2048));
    const beforeMtime = fs.statSync(file).mtimeMs;

    const { status, stdout } = runAudioStatus(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("1 recording(s) held");
    expect(stdout).toContain("next release due");

    // Read-only: neither the database nor the wav moved.
    expect(fs.statSync(file).mtimeMs).toBe(beforeMtime);
    expect(fs.existsSync(wavFile)).toBe(true);
  });
});
