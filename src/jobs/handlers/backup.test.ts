import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { enqueueJob } from "@/jobs/queue";
import { activitySessions } from "@/db/schema";
import { ingestHeartbeat } from "@/domain/activity";
import { createBackupHandler, backupsDir, backupFilePath } from "./backup";

describe("backup handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("writes an openable online backup and prunes to the newest 7 files", async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 1; n <= 9; n++) {
      fs.writeFileSync(path.join(dir, `brain-2020-01-0${n}.db`), "not a real db");
    }
    expect(fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f))).toHaveLength(9);

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    const file = backupFilePath();
    expect(fs.existsSync(file)).toBe(true);
    const backup = new Database(file, { readonly: true });
    try {
      const row = backup.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'").get();
      expect(row).toBeTruthy();
    } finally {
      backup.close();
    }

    const remaining = fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f));
    expect(remaining).toHaveLength(7);
    expect(remaining).toContain(path.basename(file));
    // The three oldest fake backups should have been pruned.
    expect(remaining).not.toContain("brain-2020-01-01.db");
    expect(remaining).not.toContain("brain-2020-01-02.db");
    expect(remaining).not.toContain("brain-2020-01-03.db");
  });

  it("prunes activity sessions past the retention window", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 100 * 86_400_000).toISOString();
    ingestHeartbeat(t.db, { at: old, appId: "com.microsoft.VSCode", appName: "Code", title: "old", url: null });
    ingestHeartbeat(t.db, { at: now.toISOString(), appId: "com.microsoft.VSCode", appName: "Code", title: "new", url: null });
    expect(t.db.select().from(activitySessions).all()).toHaveLength(2);

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    const remaining = t.db.select().from(activitySessions).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].title).toBe("new");
  });
});
