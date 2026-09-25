import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, afterEach } from "vitest";
import { openDatabase, type DB } from "@/db/client";
import { createItem, getItem, parseMeta, updateItem } from "@/domain/items";
import type { RecordingMeta } from "@/domain/meetings/recorder";

const REPO_ROOT = path.resolve(__dirname, "../..");
function runReleaseAudio(dataDir: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", "src/scripts/release-audio.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, SB_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function meeting(db: DB, dataDir: string, opts: { title: string; endedAt: string; transcript?: string }): { id: number; wavPath: string } {
  const wavPath = `meetings/${opts.title}.wav`;
  const recording: RecordingMeta = { startedAt: opts.endedAt, endedAt: opts.endedAt, wavPath, state: "done", autoStarted: false };
  const item = createItem(db, { type: "meeting", title: opts.title, status: "ready", meta: { recording } });
  if (opts.transcript !== undefined) updateItem(db, item.id, { extractedText: opts.transcript });
  const file = path.join(dataDir, "files", wavPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(4096));
  return { id: item.id, wavPath: file };
}

describe("release-audio.ts CLI", () => {
  let dataDir: string;
  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("releases a transcribed recording past the window, and never one with no transcript", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-release-audio-"));
    const db: DB = openDatabase(path.join(dataDir, "brain.db"));
    const past = meeting(db, dataDir, { title: "Past window", endedAt: "2026-01-01T10:00:00.000Z", transcript: "we agreed to ship on Friday" });
    const untranscribed = meeting(db, dataDir, { title: "No transcript", endedAt: "2020-01-01T10:00:00.000Z" });
    db.$client.close();

    const { status, stdout } = runReleaseAudio(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("released 1 recording(s)");
    expect(fs.existsSync(past.wavPath)).toBe(false);
    expect(fs.existsSync(untranscribed.wavPath)).toBe(true); // the rule that cannot be broken

    const after: DB = openDatabase(path.join(dataDir, "brain.db"));
    expect(getItem(after, past.id)!.extractedText).toContain("ship on Friday");
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(after, past.id)!).audioReleasedAt).toBeTruthy();
    expect(parseMeta<{ audioReleasedAt?: string }>(getItem(after, untranscribed.id)!).audioReleasedAt).toBeUndefined();
    after.$client.close();
  });

  it("sweeps an orphaned wav no item points at", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-release-audio-"));
    const db: DB = openDatabase(path.join(dataDir, "brain.db"));
    db.$client.close();
    const orphan = path.join(dataDir, "files", "meetings", "nobody-points-here.wav");
    fs.mkdirSync(path.dirname(orphan), { recursive: true });
    fs.writeFileSync(orphan, Buffer.alloc(1024));

    const { status, stdout } = runReleaseAudio(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("nothing was due for release");
    expect(stdout).toContain("swept 1 orphaned recording(s)");
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it("says so when there is nothing to do", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-release-audio-"));
    openDatabase(path.join(dataDir, "brain.db")).$client.close();

    const { status, stdout } = runReleaseAudio(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("nothing was due for release");
    expect(stdout).not.toContain("swept");
  });
});
