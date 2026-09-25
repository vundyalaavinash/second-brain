import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach } from "vitest";
import { openDatabase } from "@/db/client";

const REPO_ROOT = path.resolve(__dirname, "../..");
function runTakeBackup(dataDir: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", "src/scripts/take-backup.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, SB_DATA_DIR: dataDir },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("take-backup.ts CLI", () => {
  let dataDir: string;
  afterEach(() => {
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports a real error, not a bogus verification failure, when there is no database yet", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-take-backup-"));
    const { status, stderr } = runTakeBackup(dataDir);
    expect(status).toBe(1);
    expect(stderr).toContain("no database at");
    // F10: this used to say "failed verification and was discarded" for a write that never happened.
    expect(stderr).not.toContain("verification");
  });

  it("writes and verifies a backup without writing anything back to the live database", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-take-backup-"));
    const file = path.join(dataDir, "brain.db");
    openDatabase(file).$client.close();

    const beforeMtime = fs.statSync(file).mtimeMs;
    const beforeBytes = fs.readFileSync(file);

    const { status, stdout } = runTakeBackup(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("backup written and verified");

    expect(fs.statSync(file).mtimeMs).toBe(beforeMtime);
    expect(fs.readFileSync(file).equals(beforeBytes)).toBe(true);

    const stamp = new Date().toISOString().slice(0, 10);
    expect(fs.existsSync(path.join(dataDir, "backups", `brain-${stamp}.db`))).toBe(true);
  });

  it("does not apply a pending migration -- it never reaches openDatabase's migration path at all", () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-take-backup-"));
    const file = path.join(dataDir, "brain.db");
    const db = openDatabase(file); // applies every real migration once, normally

    // Make it look like the newest migration is still pending, the way pendingMigrations() reads
    // it: MAX(created_at) in __drizzle_migrations behind the journal's newest entry.
    const before = db.$client.prepare("SELECT MAX(created_at) AS c FROM __drizzle_migrations").get() as { c: number };
    db.$client.prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?").run(before.c);
    const afterDelete = db.$client.prepare("SELECT MAX(created_at) AS c FROM __drizzle_migrations").get() as { c: number };
    expect(afterDelete.c).not.toBe(before.c); // sanity: the fixture actually changed something
    db.$client.close();

    const { status, stdout } = runTakeBackup(dataDir);
    expect(status).toBe(0);
    expect(stdout).toContain("backup written and verified");

    // No pre-migration snapshot -- snapshotBeforeMigrate is only ever reached from
    // openDatabase's migration path, which take-backup.ts must never touch.
    const names = fs.readdirSync(path.join(dataDir, "backups"));
    expect(names.some((n) => n.startsWith("pre-"))).toBe(false);

    // And the live database's migrations table still reads exactly as the fixture left it --
    // nothing re-inserted a row, which is what migrate() would have done.
    const check = new Database(file, { readonly: true, fileMustExist: true });
    const stillMissing = check.prepare("SELECT MAX(created_at) AS c FROM __drizzle_migrations").get() as { c: number };
    check.close();
    expect(stillMissing.c).toBe(afterDelete.c);
  });
});
