import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { recordDbCheck } from "@/db/safety";
import { backupsDir } from "@/lib/paths";
import { safetyStatus } from "./safety-status";

/** `getLastDbCheck`'s recorded state lives on `globalThis`, independent of `SB_DATA_DIR` --
 * reset it between tests the same way `makeTempDataDir` resets the database singleton, so one
 * test's recorded check can never leak into the next. */
function resetDbCheck(): void {
  (globalThis as unknown as { __sbDbCheck?: unknown }).__sbDbCheck = undefined;
}

function seedBackup(dir: string, date: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `brain-${date}.db`), "not a real db -- only the name and mtime matter here");
}

let t: TestDb;
beforeEach(() => {
  t = makeTestDb();
  resetDbCheck();
});
afterEach(() => {
  t.cleanup();
  resetDbCheck();
});

describe("safetyStatus", () => {
  it("says there is nothing to report when neither a backup nor a check has ever run", () => {
    const status = safetyStatus(t.db);
    expect(status).toMatchObject({ lastBackupAt: null, recoveryPoints: 0, oldest: null, verified: true });
    // Silence must mean checked and sound, not unchecked (design §2, §7) -- a process that has
    // never recorded a check cannot claim its database is sound.
    expect(status.integrity.ok).toBe(false);
  });

  it("reads the newest backup's own mtime, not its date-only file name", () => {
    seedBackup(backupsDir(), "2026-09-20");
    const before = new Date();
    const status = safetyStatus(t.db);
    expect(status.lastBackupAt).not.toBeNull();
    expect(Date.parse(status.lastBackupAt!)).toBeGreaterThanOrEqual(before.getTime() - 5000);
  });

  it("counts how far back the recovery points reach", () => {
    const dir = backupsDir();
    for (const date of ["2026-09-20", "2026-09-19", "2026-08-01", "2026-04-12"]) seedBackup(dir, date);
    const status = safetyStatus(t.db);
    expect(status.recoveryPoints).toBe(4);
    expect(status.oldest).toBe("2026-04-12");
  });

  it("reports verified when the last recorded check was a sound backup", () => {
    recordDbCheck({ ok: true, problems: [] }, "backup");
    const status = safetyStatus(t.db);
    expect(status.verified).toBe(true);
    expect(status.integrity).toEqual({ ok: true, problems: [] });
  });

  it("reports the last backup failed to verify", () => {
    recordDbCheck({ ok: false, problems: ["not a database"] }, "backup");
    const status = safetyStatus(t.db);
    expect(status.verified).toBe(false);
    expect(status.integrity).toEqual({ ok: false, problems: ["not a database"] });
  });

  it("does not blame the backup for a problem a boot check found", () => {
    recordDbCheck({ ok: false, problems: ["1 foreign key violation(s)"] }, "boot");
    const status = safetyStatus(t.db);
    expect(status.verified).toBe(true);
    expect(status.integrity).toEqual({ ok: false, problems: ["1 foreign key violation(s)"] });
  });
});
