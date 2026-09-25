/**
 * Covers the bash functions `cmd_restore` (`scripts/brain.sh`) is built from -- the highest
 * consequence code in this slice, and the one the review found had no automated coverage at all.
 * `cmd_restore` itself can't be driven here (it calls `cmd_stop`/`cmd_start`, which talk to the
 * real, fixed launchd label regardless of `SB_DATA_DIR`), but its actual file-moving logic is
 * extracted into standalone functions -- `resolve_backup_file`, `move_db_aside`, `copy_db_set`,
 * `restore_attachments_for_date` -- exactly so a test can source `brain.sh` and call each one
 * directly against a real temporary directory, real bash (not this repo's default zsh, whose
 * `set -e`/`[[ =~ ]]` semantics differ), with only real file operations to observe.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const BRAIN_SH = path.resolve(__dirname, "../../scripts/brain.sh");

/** Sources `scripts/brain.sh` (harmless: an empty `$1` only hits its `usage` branch) into a real
 * `bash` process and runs `script` against the sourced functions, returning its status and
 * output. `set +e` after sourcing, because `brain.sh` itself starts with `set -euo pipefail` and
 * `source` carries that into the caller -- without turning it off, a deliberately-failing call
 * (a refusal) would abort the whole test script before it could report the exit code. */
function runBash(script: string): { status: number | null; stdout: string; stderr: string } {
  const full = `source "${BRAIN_SH}" "" >/dev/null 2>&1\nset +e\n${script}\n`;
  const result = spawnSync("bash", ["-c", full], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("move_db_aside", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-move-aside-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "dest"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("moves the base and both sidecars as a set", () => {
    fs.writeFileSync(path.join(dir, "src/brain.db"), "db");
    fs.writeFileSync(path.join(dir, "src/brain.db-wal"), "wal");
    fs.writeFileSync(path.join(dir, "src/brain.db-shm"), "shm");

    const { status, stdout } = runBash(`move_db_aside "${dir}/src/brain.db" "${dir}/dest/replaced.db"`);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("1");
    expect(fs.existsSync(path.join(dir, "src/brain.db"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "dest/replaced.db"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dest/replaced.db-wal"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "dest/replaced.db-shm"))).toBe(true);
  });

  it("F4: moves an orphaned -wal even when there is no base file -- the crash that sends someone here", () => {
    fs.writeFileSync(path.join(dir, "src/brain.db-wal"), "rows not yet checkpointed");

    const { status, stdout } = runBash(`move_db_aside "${dir}/src/brain.db" "${dir}/dest/replaced.db"`);

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("1");
    expect(fs.existsSync(path.join(dir, "src/brain.db-wal"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "dest/replaced.db-wal"))).toBe(true);
  });

  it("reports 0 and touches nothing when there is nothing at the source", () => {
    const { status, stdout } = runBash(`move_db_aside "${dir}/src/brain.db" "${dir}/dest/replaced.db"`);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe("0");
    expect(fs.existsSync(path.join(dir, "dest/replaced.db"))).toBe(false);
  });

  it("F7: refuses when the destination already exists, leaving the source untouched", () => {
    fs.writeFileSync(path.join(dir, "src/brain.db"), "db");
    fs.writeFileSync(path.join(dir, "dest/replaced.db"), "already here");

    const { status } = runBash(`move_db_aside "${dir}/src/brain.db" "${dir}/dest/replaced.db"`);

    expect(status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, "src/brain.db"))).toBe(true);
    expect(fs.readFileSync(path.join(dir, "dest/replaced.db"), "utf8")).toBe("already here");
  });

  it("F7: refuses when only a sidecar of the destination already exists", () => {
    fs.writeFileSync(path.join(dir, "src/brain.db"), "db");
    fs.writeFileSync(path.join(dir, "dest/replaced.db-wal"), "already here");

    const { status } = runBash(`move_db_aside "${dir}/src/brain.db" "${dir}/dest/replaced.db"`);

    expect(status).not.toBe(0);
    expect(fs.existsSync(path.join(dir, "src/brain.db"))).toBe(true);
  });
});

describe("copy_db_set", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-copy-set-"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.mkdirSync(path.join(dir, "dest"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("F1: copies the base and its -wal together, not the base alone", () => {
    fs.writeFileSync(path.join(dir, "src/backup.db"), "db bytes");
    fs.writeFileSync(path.join(dir, "src/backup.db-wal"), "committed rows still only in the log");

    const { status } = runBash(`copy_db_set "${dir}/src/backup.db" "${dir}/dest/brain.db"`);

    expect(status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "dest/brain.db"), "utf8")).toBe("db bytes");
    expect(fs.readFileSync(path.join(dir, "dest/brain.db-wal"), "utf8")).toBe("committed rows still only in the log");
    // The source is a copy source, never consumed.
    expect(fs.existsSync(path.join(dir, "src/backup.db"))).toBe(true);
  });

  it("clears a stale destination sidecar when the source has none of its own", () => {
    fs.writeFileSync(path.join(dir, "src/backup.db"), "db bytes");
    fs.writeFileSync(path.join(dir, "dest/brain.db-wal"), "stale, from whatever used to be here");

    const { status } = runBash(`copy_db_set "${dir}/src/backup.db" "${dir}/dest/brain.db"`);

    expect(status).toBe(0);
    expect(fs.existsSync(path.join(dir, "dest/brain.db-wal"))).toBe(false);
  });
});

describe("restore_attachments_for_date", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-restore-attach-"));
    fs.mkdirSync(path.join(dir, "backups"));
    fs.mkdirSync(path.join(dir, "data"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("F2: moves current attachments aside rather than deleting them, then installs the dated backup", () => {
    fs.mkdirSync(path.join(dir, "backups/attachments-2026-09-20"));
    fs.writeFileSync(path.join(dir, "backups/attachments-2026-09-20/marker.txt"), "from the backup");
    fs.mkdirSync(path.join(dir, "data/attachments"));
    fs.writeFileSync(path.join(dir, "data/attachments/current-only.txt"), "current, about to be moved aside");

    const { status, stdout } = runBash(
      `restore_attachments_for_date "2026-09-20" "${dir}/backups" "${dir}/data" "STAMP1"`,
    );

    expect(status).toBe(0);
    const replacedAt = stdout.trim();
    expect(replacedAt).toBe(path.join(dir, "backups/attachments-replaced-STAMP1"));
    // Nothing was deleted: the previous attachments exist, in full, at the printed path.
    expect(fs.readFileSync(path.join(replacedAt, "current-only.txt"), "utf8")).toBe("current, about to be moved aside");
    // The new attachments are the dated backup's.
    expect(fs.existsSync(path.join(dir, "data/attachments/marker.txt"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "data/attachments/current-only.txt"))).toBe(false);
  });

  it("does nothing, and reports nothing moved, when there is no dated attachments backup", () => {
    fs.mkdirSync(path.join(dir, "data/attachments"));
    fs.writeFileSync(path.join(dir, "data/attachments/keepme.txt"), "untouched");

    const { status, stdout } = runBash(
      `restore_attachments_for_date "2099-01-01" "${dir}/backups" "${dir}/data" "STAMP2"`,
    );

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(fs.readFileSync(path.join(dir, "data/attachments/keepme.txt"), "utf8")).toBe("untouched");
  });

  it("installs the dated backup without moving anything aside when there were no current attachments", () => {
    fs.mkdirSync(path.join(dir, "backups/attachments-2026-09-20"));
    fs.writeFileSync(path.join(dir, "backups/attachments-2026-09-20/marker.txt"), "from the backup");

    const { status, stdout } = runBash(
      `restore_attachments_for_date "2026-09-20" "${dir}/backups" "${dir}/data" "STAMP3"`,
    );

    expect(status).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(fs.existsSync(path.join(dir, "data/attachments/marker.txt"))).toBe(true);
  });
});

describe("resolve_backup_file", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-resolve-"));
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db"), "x");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("resolves a real backup by name", () => {
    const { status, stdout } = runBash(`resolve_backup_file "brain-2026-09-24.db" "${dir}"`);
    expect(status).toBe(0);
    expect(fs.realpathSync(stdout.trim())).toBe(fs.realpathSync(path.join(dir, "brain-2026-09-24.db")));
  });

  it("refuses a ../ escape to a file that genuinely exists one level up", () => {
    const outside = path.join(path.dirname(dir), `sb-resolve-outside-${process.pid}.db`);
    fs.writeFileSync(outside, "not in the backups directory");
    try {
      const { status, stderr } = runBash(`resolve_backup_file "../${path.basename(outside)}" "${dir}"`);
      expect(status).not.toBe(0);
      expect(stderr).toContain("outside the backups directory");
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it("refuses a symlink pointing outside the directory", () => {
    fs.symlinkSync("/etc/passwd", path.join(dir, "sneak.db"));
    const { status, stderr } = runBash(`resolve_backup_file "sneak.db" "${dir}"`);
    expect(status).not.toBe(0);
    expect(stderr).toContain("outside the backups directory");
  });

  it("refuses a name that does not exist", () => {
    const { status, stderr } = runBash(`resolve_backup_file "brain-2099-01-01.db" "${dir}"`);
    expect(status).not.toBe(0);
    expect(stderr).toContain("no such backup");
  });
});
