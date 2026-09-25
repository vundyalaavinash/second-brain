import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { formatSize, resolveInBackups, verifyOne, OutsideBackupsDirError, NoSuchBackupError } from "./verify-backups";

/** Runs `src/scripts/<script>` as a real CLI subprocess, the way `scripts/brain.sh` does (`npx
 * tsx ...`), with `SB_DATA_DIR` pointed at `dataDir` -- so these tests cover the actual exit-code
 * contract `main()` promises (brief step 1: "exits non-zero if any file fails"), which nothing
 * that imports the module directly can, since `main()` calls `process.exit`. Slower than a plain
 * unit test (a real node process per call), so used sparingly, for exit codes and top-level
 * messages only. */
const REPO_ROOT = path.resolve(__dirname, "../..");
function runScript(script: string, args: string[], dataDir: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", `src/scripts/${script}`, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, SB_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("formatSize", () => {
  it("renders bytes, kilobytes and megabytes at their natural boundaries", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("resolveInBackups", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-verify-resolve-"));
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db"), "a real backup");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("resolves a bare filename inside the backups directory", () => {
    expect(resolveInBackups(dir, "brain-2026-09-24.db")).toBe(fs.realpathSync(path.join(dir, "brain-2026-09-24.db")));
  });

  it("resolves an absolute path that is genuinely inside the backups directory", () => {
    const abs = path.join(dir, "brain-2026-09-24.db");
    expect(resolveInBackups(dir, abs)).toBe(fs.realpathSync(abs));
  });

  it("refuses a ../ escape out of the backups directory", () => {
    const outside = path.join(path.dirname(dir), `sb-verify-outside-${process.pid}.db`);
    fs.writeFileSync(outside, "not in the backups directory");
    try {
      expect(() => resolveInBackups(dir, `../${path.basename(outside)}`)).toThrow(OutsideBackupsDirError);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses an absolute path elsewhere on disk", () => {
    expect(() => resolveInBackups(dir, "/etc/passwd")).toThrow(OutsideBackupsDirError);
  });

  it("refuses a name whose path does not exist at all", () => {
    expect(() => resolveInBackups(dir, "brain-2099-01-01.db")).toThrow(NoSuchBackupError);
  });

  it("refuses a name that merely starts with the directory's own name as a string", () => {
    const evilDir = `${dir}-evil`;
    fs.mkdirSync(evilDir);
    fs.writeFileSync(path.join(evilDir, "x.db"), "x");
    try {
      expect(() => resolveInBackups(dir, path.join(evilDir, "x.db"))).toThrow(OutsideBackupsDirError);
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it("refuses a symlink inside the backups directory that points outside it", () => {
    // Reproduces the review's finding directly: `ln -s /etc/passwd backups/sneak.db` used to
    // resolve as "inside" the directory (path.resolve is purely textual) and get opened.
    const link = path.join(dir, "sneak.db");
    fs.symlinkSync("/etc/passwd", link);
    expect(() => resolveInBackups(dir, "sneak.db")).toThrow(OutsideBackupsDirError);
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

describe("verify-backups.ts CLI (main's exit-code contract)", () => {
  let dataDir: string;
  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-verify-cli-"));
  });
  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  it("exits non-zero when the backups directory does not exist", () => {
    const { status, stderr } = runScript("verify-backups.ts", [], dataDir);
    expect(status).toBe(1);
    expect(stderr).toContain("no backups directory");
  });

  it("exits non-zero when the backups directory is empty", () => {
    fs.mkdirSync(path.join(dataDir, "backups"));
    const { status } = runScript("verify-backups.ts", [], dataDir);
    expect(status).toBe(1);
  });

  it("exits zero and prints sound for a real, sound backup", () => {
    const dir = path.join(dataDir, "backups");
    fs.mkdirSync(dir, { recursive: true });
    const t = makeTestDb();
    // Checkpoint before copying: a plain file copy of a WAL-mode database, without also copying
    // its -wal, can miss committed rows still only in the log -- the exact hazard F1 named.
    t.db.$client.pragma("wal_checkpoint(TRUNCATE)");
    fs.copyFileSync(path.join(t.dir, "test.db"), path.join(dir, "brain-2026-09-24.db"));
    t.cleanup();

    const { status, stdout } = runScript("verify-backups.ts", [], dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("sound");
  });

  it("exits non-zero when one file in the directory is unsound", () => {
    const dir = path.join(dataDir, "backups");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db"), "not a database");

    const { status, stdout } = runScript("verify-backups.ts", [], dataDir);
    expect(status).toBe(1);
    expect(stdout).toContain("UNSOUND");
  });

  it("exits non-zero in single-file mode for a path outside the backups directory, refused before opening anything", () => {
    fs.mkdirSync(path.join(dataDir, "backups"));
    const { status, stderr } = runScript("verify-backups.ts", ["/etc/passwd"], dataDir);
    expect(status).toBe(1);
    expect(stderr).toContain("refusing");
    expect(stderr).toContain("outside the backups directory");
  });
});
