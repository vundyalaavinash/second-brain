import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestDb, makeTempDataDir, type TestDb } from "@/test/db";
import { enqueueJob } from "@/jobs/queue";
import { activitySessions } from "@/db/schema";
import { ingestHeartbeat } from "@/domain/activity";
import { createItem } from "@/domain/items";
import { saveAttachment, attachmentPath } from "@/domain/attachments";
import * as safety from "@/db/safety";
import { createBackupHandler, backupsDir, backupFilePath, backupDateStamp, pruneBackups, sweepSidecars, KEEP_DAILY, KEEP_WEEKLY, KEEP_MONTHLY } from "./backup";

describe("backup handler", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => {
    t.cleanup();
    vi.restoreAllMocks();
  });

  it("writes an openable, verified backup", async () => {
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
  });

  it("deletes what it wrote when the file will not open, and says so", async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    // Twenty pre-existing daily backups: enough that if a prune ran despite the failure, the
    // count below would drop. They stand in for "the older backups", which are now the only
    // ones that exist and must be left exactly alone.
    for (let n = 1; n <= 20; n++) {
      fs.writeFileSync(path.join(dir, `brain-2020-02-${String(n).padStart(2, "0")}.db`), "not a real db");
    }

    const verifySpy = vi.spyOn(safety, "verifyDatabaseFile").mockReturnValue({ ok: false, problems: ["simulated corruption"] });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    expect(fs.existsSync(backupFilePath())).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call) => String(call[0]).toLowerCase().includes("backup"))).toBe(true);

    const remaining = fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f));
    expect(remaining).toHaveLength(20); // untouched -- no prune ran

    verifySpy.mockRestore();
    errorSpy.mockRestore();
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

  it("copies the attachments directory into the backup", async () => {
    const item = createItem(t.db, { type: "note", title: "n" });
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const a = saveAttachment(t.db, { itemId: item.id, filename: "shot.png", mime: "image/png", bytes });

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    const copied = path.join(backupsDir(), `attachments-${backupDateStamp()}`, String(item.id), path.basename(attachmentPath(a)));
    expect(fs.existsSync(copied)).toBe(true);
    expect(fs.readFileSync(copied)).toEqual(bytes);
  });

  it("leaves an attachments backup alone when there are no attachments", async () => {
    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    const dir = backupsDir();
    const attachmentsBackups = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^attachments-/.test(f)) : [];
    expect(attachmentsBackups).toEqual([]);
  });
});

describe("pruneBackups", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDataDir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function seed(dates: string[]): void {
    for (const d of dates) fs.writeFileSync(path.join(dir, `brain-${d}.db`), "not a real db");
  }

  it("keeps the newest of each tier rather than only the newest seven", () => {
    // "Now" is Sunday 2026-09-27, so the newest 7 calendar days (Sep 21-27) are exactly one ISO
    // week -- a clean boundary for the tiers below.
    const daily = ["2026-09-27", "2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23", "2026-09-22", "2026-09-21"];

    // Four distinct ISO weeks before that, one file each, so each is unambiguously its week's
    // only (and therefore newest) file.
    const weekly = ["2026-09-14", "2026-09-07", "2026-08-31", "2026-08-24"];

    // A fifth week, older still, with a single file of its own -- daily and weekly cannot keep
    // it (weekly's quota of 4 is already spent on the weeks above), so it is exactly the kind of
    // leftover the monthly tier exists to catch. It becomes August's monthly pick.
    const fifthWeekLeftover = "2026-08-17";

    // Five more distinct months, one file each, filling the rest of the monthly tier's six slots
    // (August is already claimed by the leftover above).
    const monthly = ["2026-07-05", "2026-06-05", "2026-05-05", "2026-04-05", "2026-03-05"];

    // One month further back than the monthly tier's cap of six -- must be dropped entirely.
    const beyondEveryTier = "2026-02-05";

    seed([...daily, ...weekly, fifthWeekLeftover, ...monthly, beyondEveryTier]);
    expect(fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f))).toHaveLength(18);

    pruneBackups(dir);

    const remaining = new Set(fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f)));
    expect(remaining.size).toBe(KEEP_DAILY + KEEP_WEEKLY + KEEP_MONTHLY);
    for (const d of daily) expect(remaining.has(`brain-${d}.db`)).toBe(true);
    for (const d of weekly) expect(remaining.has(`brain-${d}.db`)).toBe(true);
    expect(remaining.has(`brain-${fifthWeekLeftover}.db`)).toBe(true);
    for (const d of monthly) expect(remaining.has(`brain-${d}.db`)).toBe(true);
    expect(remaining.has(`brain-${beyondEveryTier}.db`)).toBe(false);
  });

  it("keeps only the newest file of a bucket two files share, once neither is the tier's newest", () => {
    const daily = ["2020-06-08", "2020-06-07", "2020-06-06", "2020-06-05", "2020-06-04", "2020-06-03", "2020-06-02"]; // the newest 7 dates overall

    // Four distinct weeks, one file each, spending the entire weekly quota on files newer than
    // the pair below.
    const fourWeeks = ["2020-05-25", "2020-05-18", "2020-05-11", "2020-05-04"];

    // A fifth, older week -- weekly's quota is already spent, so neither of these two same-week,
    // same-month files can be picked there. Both fall through to the monthly tier, which shares
    // the same "keep only the bucket's newest" logic keyed by month instead of week: proof that
    // a bucket a tier does pick from still keeps only its single newest entry, not both.
    const newerOfPair = "2020-04-28";
    const olderOfPair = "2020-04-27";

    seed([...daily, ...fourWeeks, newerOfPair, olderOfPair]);

    pruneBackups(dir);

    const remaining = new Set(fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f)));
    for (const d of fourWeeks) expect(remaining.has(`brain-${d}.db`)).toBe(true);
    expect(remaining.has(`brain-${newerOfPair}.db`)).toBe(true); // the newer of the pair, kept by the monthly tier
    expect(remaining.has(`brain-${olderOfPair}.db`)).toBe(false); // the older, same-week, same-month duplicate
  });

  it("never touches pre-*.db snapshots, no matter how old", () => {
    fs.writeFileSync(path.join(dir, "pre-0001_init-2019-01-01T00-00-00-000Z.db"), "a snapshot");

    // Ninety consecutive days of brain-*.db: far more than any tier keeps, so pruning is
    // guaranteed to delete some of them -- the exact scenario in which an over-broad pattern
    // could reach a pre-*.db snapshot too, if one existed.
    const start = new Date("2025-01-01T00:00:00.000Z");
    const dates: string[] = [];
    for (let i = 0; i < 90; i++) dates.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    seed(dates);

    pruneBackups(dir);

    const remainingBrain = fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f));
    expect(remainingBrain.length).toBeLessThan(90); // proves deletions actually happened
    expect(fs.existsSync(path.join(dir, "pre-0001_init-2019-01-01T00-00-00-000Z.db"))).toBe(true);
  });

  it("does nothing when the directory does not exist", () => {
    expect(() => pruneBackups(path.join(dir, "nope"))).not.toThrow();
  });
});

describe("sweepSidecars", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDataDir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("sweeps the -wal, -shm, and -journal files the old pattern could not see", () => {
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db"), "a real backup");
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db-wal"), "wal debris");
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db-shm"), "shm debris");
    fs.writeFileSync(path.join(dir, "pre-0001_init-stamp.db.tmp-journal"), "journal debris from a killed vacuum");

    const removed = sweepSidecars(dir);

    expect(removed).toBe(3);
    expect(fs.existsSync(path.join(dir, "brain-2026-09-24.db-wal"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "brain-2026-09-24.db-shm"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "pre-0001_init-stamp.db.tmp-journal"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "brain-2026-09-24.db"))).toBe(true); // a legitimate .db is not touched
  });

  it("touches nothing when there is nothing to sweep", () => {
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db"), "a real backup");
    expect(sweepSidecars(dir)).toBe(0);
    expect(fs.existsSync(path.join(dir, "brain-2026-09-24.db"))).toBe(true);
  });

  it("does nothing when the directory does not exist", () => {
    expect(sweepSidecars(path.join(dir, "nope"))).toBe(0);
  });
});
