import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { recordDbCheck } from "@/db/safety";
import { backupsDir } from "@/lib/paths";
import { createItem, updateItem } from "@/domain/items";
import type { RecordingMeta } from "@/domain/meetings/recorder";
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
    // Design §9's seam: nothing held, nothing due.
    expect(status.audio).toEqual({ recordings: 0, bytes: 0, nextReleaseAt: null });
  });

  it("folds design §9's audio footprint into the same status", () => {
    const wavPath = "meetings/Standup.wav";
    const recording: RecordingMeta = { startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T10:00:00.000Z", wavPath, state: "done", autoStarted: false };
    const item = createItem(t.db, { type: "meeting", title: "Standup", status: "ready", meta: { recording } });
    updateItem(t.db, item.id, { extractedText: "what was said" });
    const file = path.join(t.dir, "files", wavPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(2048));

    const status = safetyStatus(t.db);
    expect(status.audio.recordings).toBe(1);
    expect(status.audio.bytes).toBe(2048);
    expect(status.audio.nextReleaseAt).toBe(new Date(Date.parse(recording.endedAt!) + 7 * 86_400_000).toISOString());
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
