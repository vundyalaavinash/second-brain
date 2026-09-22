import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setSetting } from "@/domain/settings";
import { makeTestDb, type TestDb } from "@/test/db";
import { checkTools, resolveTool } from "./tools";

function fakeExecutable(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(p, 0o755);
  return p;
}

describe("resolveTool", () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-tools-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("returns the first executable found in the given directories", () => {
    const bin = fakeExecutable(dir, "whisper-cli");
    expect(resolveTool("whisper-cli", ["/no/such/dir", dir])).toBe(bin);
  });

  it("returns null when no directory holds the tool", () => {
    expect(resolveTool("whisper-cli", [dir])).toBeNull();
  });

  it("ignores a non-executable file and a directory with the tool's name", () => {
    fs.writeFileSync(path.join(dir, "ffmpeg"), "text, not a program");
    fs.mkdirSync(path.join(dir, "whisper-cli"));
    expect(resolveTool("ffmpeg", [dir])).toBeNull();
    expect(resolveTool("whisper-cli", [dir])).toBeNull();
  });
});

describe("checkTools", () => {
  let t: TestDb;
  let binDir: string;
  beforeEach(() => {
    t = makeTestDb();
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-path-"));
  });
  afterEach(() => {
    t.cleanup();
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  it("resolves tools from PATH and reports what is missing", () => {
    fakeExecutable(binDir, "whisper-cli");
    const tools = checkTools(t.db, { pathDirs: [binDir] });
    expect(tools.whisper).toMatch(/whisper-cli$/);
    expect(tools.ffmpeg).toBeNull();
    expect(tools.missing).toContain("ffmpeg");
    expect(tools.missing).not.toContain("whisper");
  });

  it("finds the recorder under the data directory and the models named by settings", () => {
    const recorder = fakeExecutable(path.join(t.dir, "bin"), "sb-recorder");
    const base = path.join(t.dir, "ggml-base.en.bin");
    fs.writeFileSync(base, "weights");
    setSetting(t.db, "meetings.whisperBase", base);
    const tools = checkTools(t.db, { pathDirs: [binDir] });
    expect(tools.recorder).toBe(recorder);
    expect(tools.baseModel).toBe(base);
    expect(tools.finalModel).toBeNull();
    expect(tools.missing).toEqual(expect.arrayContaining(["whisper", "ffmpeg", "finalModel"]));
    expect(tools.missing).not.toContain("recorder");
    expect(tools.missing).not.toContain("baseModel");
  });

  it("reports nothing missing once every tool and model is present", () => {
    fakeExecutable(binDir, "whisper-cli");
    fakeExecutable(binDir, "ffmpeg");
    fakeExecutable(path.join(t.dir, "bin"), "sb-recorder");
    for (const [key, name] of [["meetings.whisperBase", "ggml-base.en.bin"], ["meetings.whisperFinal", "ggml-medium.en.bin"]]) {
      const p = path.join(t.dir, name);
      fs.writeFileSync(p, "weights");
      setSetting(t.db, key, p);
    }
    expect(checkTools(t.db, { pathDirs: [binDir] }).missing).toEqual([]);
  });

  it("defaults the model settings to the data directory", () => {
    const tools = checkTools(t.db, { pathDirs: [binDir] });
    expect(tools.baseModel).toBeNull();
    expect(tools.missing).toContain("baseModel");
    fs.mkdirSync(path.join(t.dir, "models", "whisper"), { recursive: true });
    fs.writeFileSync(path.join(t.dir, "models", "whisper", "ggml-base.en.bin"), "weights");
    expect(checkTools(t.db, { pathDirs: [binDir] }).baseModel).toBe(path.join(t.dir, "models", "whisper", "ggml-base.en.bin"));
  });
});
