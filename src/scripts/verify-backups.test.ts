import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { formatSize, resolveInBackups, verifyOne, OutsideBackupsDirError } from "./verify-backups";

describe("formatSize", () => {
  it("renders bytes, kilobytes and megabytes at their natural boundaries", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("resolveInBackups", () => {
  const dir = "/data/backups";

  it("resolves a bare filename inside the backups directory", () => {
    expect(resolveInBackups(dir, "brain-2026-09-24.db")).toBe(path.join(dir, "brain-2026-09-24.db"));
  });

  it("resolves an absolute path that is genuinely inside the backups directory", () => {
    expect(resolveInBackups(dir, "/data/backups/brain-2026-09-24.db")).toBe("/data/backups/brain-2026-09-24.db");
  });

  it("refuses a ../ escape out of the backups directory", () => {
    expect(() => resolveInBackups(dir, "../brain.db")).toThrow(OutsideBackupsDirError);
  });

  it("refuses an absolute path elsewhere on disk", () => {
    expect(() => resolveInBackups(dir, "/etc/passwd")).toThrow(OutsideBackupsDirError);
  });

  it("refuses a name that merely starts with the directory's own name as a string", () => {
    // /data/backups-evil/x must not pass just because it starts with "/data/backups" as text.
    expect(() => resolveInBackups(dir, "/data/backups-evil/x")).toThrow(OutsideBackupsDirError);
  });
});

describe("verifyOne", () => {
  let t: TestDb;
  afterEach(() => {
    t?.cleanup();
    vi.restoreAllMocks();
  });

  it("prints a sound line and returns true for a real, openable database", () => {
    t = makeTestDb();
    const file = path.join(t.dir, "test.db");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(verifyOne(file)).toBe(true);
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain(path.basename(file));
    expect(line).toContain("sound");
  });

  it("prints an UNSOUND line naming the problem and returns false for a file that is not a database", () => {
    t = makeTestDb();
    const file = path.join(t.dir, "not-a-database.db");
    fs.writeFileSync(file, "definitely not sqlite");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(verifyOne(file)).toBe(false);
    const line = String(logSpy.mock.calls[0][0]);
    expect(line).toContain("UNSOUND");
  });
});
