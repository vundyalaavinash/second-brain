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
import { getLastDbCheck } from "@/db/safety";
import {
  createBackupHandler,
  backupsDir,
  backupFilePath,
  backupDateStamp,
  pruneBackups,
  pruneSnapshots,
  sweepSidecars,
  recoveryPointSummary,
  KEEP_DAILY,
  KEEP_WEEKLY,
  KEEP_MONTHLY,
} from "./backup";

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
    expect(getLastDbCheck()).toMatchObject({ ok: true, source: "backup" });
  });

  it("deletes what it wrote when the file will not open, and says so, but still backs up attachments", async () => {
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    // Twenty pre-existing daily backups: enough that if a prune ran despite the failure, the
    // count below would drop. They stand in for "the older backups", which are now the only
    // ones that exist and must be left exactly alone.
    for (let n = 1; n <= 20; n++) {
      fs.writeFileSync(path.join(dir, `brain-2020-02-${String(n).padStart(2, "0")}.db`), "not a real db");
    }
    const item = createItem(t.db, { type: "note", title: "n" });
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const a = saveAttachment(t.db, { itemId: item.id, filename: "shot.png", mime: "image/png", bytes });

    // Make the write itself produce a corrupt file -- not a stub of verifyDatabaseFile, so this
    // proves the real corruption-detection path, not just that the handler reacts to whatever a
    // mock hands it.
    const backupSpy = vi.spyOn(t.db.$client, "backup").mockImplementation(async (destination: string) => {
      fs.writeFileSync(destination, "garbage bytes, not a real database");
      return undefined as never;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    expect(fs.existsSync(backupFilePath())).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call) => String(call[0]).toLowerCase().includes("backup"))).toBe(true);

    const remaining = fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f));
    expect(remaining).toHaveLength(20); // untouched -- no prune ran

    expect(getLastDbCheck()).toMatchObject({ ok: false, source: "backup" });

    // A bad database copy is not a reason to also lose a night of attachments.
    const copied = path.join(backupsDir(), `attachments-${backupDateStamp()}`, String(item.id), path.basename(attachmentPath(a)));
    expect(fs.existsSync(copied)).toBe(true);

    backupSpy.mockRestore();
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

  it("N2: a stray attachments-replaced-* directory in the backups directory survives a real nightly run, and never crowds out a genuine dated backup", async () => {
    // N2 from the re-review: `^attachments-.*$` also matched `attachments-replaced-<stamp>` --
    // what restore moves the live attachments aside to -- and because "r" sorts above every digit,
    // pruneOld's newest-N-by-name-sort treated every replaced directory as newer than any real
    // dated one, so a real run deleted the genuine backups (including the one it had just written)
    // and kept the replaced ones. Restore itself no longer writes into the backups directory (it
    // writes under the data directory now), but this proves the handler is safe regardless of
    // where such a name might come from -- eight replaced-shaped directories plus enough genuine
    // dated ones to force real deletions, run through the real, unmocked handler.
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    for (let n = 0; n < 8; n++) {
      const replaced = path.join(dir, `attachments-replaced-2026-09-${String(10 + n).padStart(2, "0")}T00-00-00-000Z`);
      fs.mkdirSync(replaced);
      fs.writeFileSync(path.join(replaced, "marker.txt"), `replaced ${n}`);
    }
    for (let n = 1; n <= 10; n++) {
      const dated = path.join(dir, `attachments-2026-08-${String(n).padStart(2, "0")}`);
      fs.mkdirSync(dated);
      fs.writeFileSync(path.join(dated, "marker.txt"), `dated ${n}`);
    }

    const item = createItem(t.db, { type: "note", title: "n" });
    const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    saveAttachment(t.db, { itemId: item.id, filename: "shot.png", mime: "image/png", bytes });

    const job = enqueueJob(t.db, "backup", {});
    await createBackupHandler({ db: t.db })(job);

    const after = fs.readdirSync(dir);
    const survivingReplaced = after.filter((f) => f.startsWith("attachments-replaced-"));
    const survivingDated = after.filter((f) => /^attachments-\d{4}-\d{2}-\d{2}$/.test(f));

    // All eight replaced directories survive -- pruneOld can no longer see them at all.
    expect(survivingReplaced).toHaveLength(8);
    // Newest ATTACHMENTS_KEEP (7) dated directories survive by date, today's (just written) among them.
    expect(survivingDated).toHaveLength(7);
    expect(survivingDated).toContain(`attachments-${backupDateStamp()}`);
    expect(survivingDated).not.toContain("attachments-2026-08-01"); // the oldest, correctly pruned
  });
});

describe("pruneBackups", () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = makeTempDataDir();
    dir = path.join(root, "backups");
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

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

    // Ninety consecutive days of brain-*.db, spanning three calendar months: enough that pruning
    // is guaranteed to delete some of them (7 daily + 4 weekly + at most 3 monthly = 14 of 90
    // survive) -- the exact scenario in which an over-broad pattern could reach a pre-*.db
    // snapshot too, if one existed.
    const start = new Date("2025-01-01T00:00:00.000Z");
    const dates: string[] = [];
    for (let i = 0; i < 90; i++) dates.push(new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    seed(dates);

    pruneBackups(dir);

    const remainingBrain = fs.readdirSync(dir).filter((f) => /^brain-.*\.db$/.test(f));
    expect(remainingBrain).toHaveLength(KEEP_DAILY + KEEP_WEEKLY + 3);
    expect(fs.existsSync(path.join(dir, "pre-0001_init-2019-01-01T00-00-00-000Z.db"))).toBe(true);
  });

  it("does not throw on a name that matches the pattern but is not a real calendar date, and never deletes it", () => {
    const impossible = "brain-2026-99-99.db";
    fs.writeFileSync(path.join(dir, impossible), "x");
    // Ten real, older backups: enough that a real prune has something to do around the bad name.
    for (let n = 1; n <= 10; n++) fs.writeFileSync(path.join(dir, `brain-2020-01-${String(n).padStart(2, "0")}.db`), "x");

    expect(() => pruneBackups(dir)).not.toThrow();
    expect(fs.existsSync(path.join(dir, impossible))).toBe(true);
  });

  it("does not throw on a directory shaped like a backup that would otherwise be pruned, and does not touch it", () => {
    // 90 real backups guarantee real deletions happen; the directory below has the oldest,
    // least-protected date, so it is exactly the kind of entry the deletion loop reaches.
    const start = new Date("2025-01-01T00:00:00.000Z");
    for (let i = 1; i < 90; i++) seed([new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)]);
    const trap = path.join(dir, "brain-2025-01-01.db");
    fs.mkdirSync(trap);

    expect(() => pruneBackups(dir)).not.toThrow();
    expect(fs.existsSync(trap)).toBe(true);
  });

  it("does nothing when the directory does not exist", () => {
    expect(() => pruneBackups(path.join(dir, "nope"))).not.toThrow();
  });
});

describe("recoveryPointSummary", () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = makeTempDataDir();
    dir = path.join(root, "backups");
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function seed(dates: string[]): void {
    for (const d of dates) fs.writeFileSync(path.join(dir, `brain-${d}.db`), "not a real db");
  }

  it("says there are none when the directory does not exist", () => {
    expect(recoveryPointSummary(path.join(dir, "nope"))).toEqual({ count: 0, oldest: null, newest: null });
  });

  it("says there are none in an empty directory", () => {
    expect(recoveryPointSummary(dir)).toEqual({ count: 0, oldest: null, newest: null });
  });

  it("counts the brain-*.db files and names the oldest and newest", () => {
    seed(["2026-04-12", "2026-09-20", "2026-08-01"]);
    expect(recoveryPointSummary(dir)).toEqual({ count: 3, oldest: "2026-04-12", newest: "brain-2026-09-20.db" });
  });

  it("ignores pre-*.db snapshots and sidecars -- only NAME_RE's brain-*.db counts", () => {
    seed(["2026-09-20"]);
    fs.writeFileSync(path.join(dir, "pre-0001_init-2026-09-19T00-00-00-000Z.db"), "x");
    fs.writeFileSync(path.join(dir, "brain-2026-09-20.db-wal"), "x");
    expect(recoveryPointSummary(dir)).toEqual({ count: 1, oldest: "2026-09-20", newest: "brain-2026-09-20.db" });
  });

  it("never counts a name that matches the pattern but is not a real calendar date", () => {
    seed(["2026-09-20"]);
    fs.writeFileSync(path.join(dir, "brain-2026-99-99.db"), "x");
    expect(recoveryPointSummary(dir)).toEqual({ count: 1, oldest: "2026-09-20", newest: "brain-2026-09-20.db" });
  });
});

describe("pruneSnapshots", () => {
  let root: string;
  let dir: string;
  const NOW = new Date("2026-09-25T00:00:00.000Z");

  beforeEach(() => {
    root = makeTempDataDir();
    dir = path.join(root, "backups");
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function snapshotName(tag: string, date: Date): string {
    return `pre-${tag}-${date.toISOString().replace(/[:.]/g, "-")}.db`;
  }
  function write(tag: string, date: Date): string {
    const name = snapshotName(tag, date);
    fs.writeFileSync(path.join(dir, name), "x");
    return name;
  }

  it("keeps the oldest and newest stamp for a retried or killed migration tag, and drops any stamp between", () => {
    // The oldest stamp is the true pre-first-attempt state; the newest is whatever the migration
    // last did (which stuck, if there's only one more). A stamp strictly between the two is a
    // retry that didn't stick either, and is genuinely redundant.
    const oldest = write("0016_commitments", new Date("2026-09-18T00:00:00.000Z"));
    const middle = write("0016_commitments", new Date("2026-09-20T00:00:00.000Z"));
    const newest = write("0016_commitments", new Date("2026-09-22T00:00:00.000Z"));

    pruneSnapshots(dir, NOW);

    expect(fs.existsSync(path.join(dir, oldest))).toBe(true);
    expect(fs.existsSync(path.join(dir, newest))).toBe(true);
    expect(fs.existsSync(path.join(dir, middle))).toBe(false);
  });

  it("keeps at most two files for a tag no matter how many times it was retried", () => {
    const names = [0, 1, 2, 3, 4].map((i) => write("0016_commitments", new Date(NOW.getTime() - (10 - i) * 86_400_000)));
    const [oldest, , , , newest] = names;

    pruneSnapshots(dir, NOW);

    const survivors = names.filter((n) => fs.existsSync(path.join(dir, n)));
    expect(survivors.sort()).toEqual([oldest, newest].sort());
  });

  it("keeps a single file for a tag with only one stamp, not two copies of it", () => {
    const only = write("0016_commitments", new Date("2026-09-20T00:00:00.000Z"));
    pruneSnapshots(dir, NOW);
    expect(fs.readdirSync(dir)).toEqual([only]);
  });

  it("keeps every remaining tag within the last twelve months, not just the floor of ten", () => {
    const names: string[] = [];
    for (let i = 1; i <= 12; i++) {
      names.push(write(`tag${i}`, new Date(NOW.getTime() - i * 20 * 86_400_000))); // up to ~240 days back
    }

    pruneSnapshots(dir, NOW);

    for (const name of names) expect(fs.existsSync(path.join(dir, name))).toBe(true);
  });

  it("keeps only the newest snapshot per quarter once a tag is older than twelve months", () => {
    // Ten recent tags fill the floor, so nothing below is rescued by it.
    const recentNames: string[] = [];
    for (let i = 1; i <= 10; i++) recentNames.push(write(`recent${i}`, new Date(NOW.getTime() - i * 10 * 86_400_000)));

    // Two old tags in the same calendar quarter, well beyond both the floor and the twelve-month window.
    const quarterNewer = write("old-newer", new Date("2020-02-01T00:00:00.000Z")); // Q1 2020
    const quarterOlder = write("old-older", new Date("2020-01-01T00:00:00.000Z")); // Q1 2020

    pruneSnapshots(dir, NOW);

    for (const name of recentNames) expect(fs.existsSync(path.join(dir, name))).toBe(true);
    expect(fs.existsSync(path.join(dir, quarterNewer))).toBe(true);
    expect(fs.existsSync(path.join(dir, quarterOlder))).toBe(false);
  });

  it("floors at the newest ten tags even when the quarterly tier alone would have kept fewer", () => {
    // Ten tags across three calendar quarters -- the quarterly tier alone would reduce these to
    // three (one per quarter), but they are also literally the ten newest tags that exist, so the
    // floor keeps all ten regardless.
    const names: string[] = [
      write("q1a", new Date("2015-01-05T00:00:00.000Z")),
      write("q1b", new Date("2015-01-15T00:00:00.000Z")),
      write("q1c", new Date("2015-02-05T00:00:00.000Z")),
      write("q1d", new Date("2015-03-05T00:00:00.000Z")),
      write("q2a", new Date("2015-04-05T00:00:00.000Z")),
      write("q2b", new Date("2015-05-05T00:00:00.000Z")),
      write("q2c", new Date("2015-06-05T00:00:00.000Z")),
      write("q3a", new Date("2015-07-05T00:00:00.000Z")),
      write("q3b", new Date("2015-08-05T00:00:00.000Z")),
      write("q3c", new Date("2015-09-05T00:00:00.000Z")),
    ];

    pruneSnapshots(dir, NOW);

    for (const name of names) expect(fs.existsSync(path.join(dir, name))).toBe(true);
  });

  it("never prunes a tag older than the oldest brain-*.db still held, even past the quarterly tier", () => {
    // Ten recent tags fill the floor, so the pair below is unprotected by anything but rule 5.
    for (let i = 1; i <= 10; i++) write(`recent${i}`, new Date(NOW.getTime() - i * 10 * 86_400_000));

    // Same quarter, so without rule 5 the quarterly tier alone would keep only the newer of the
    // two and drop the older one.
    const protectedByRule5 = write("ancient-older", new Date("2010-01-01T00:00:00.000Z"));
    const quarterWinner = write("ancient-newer", new Date("2010-02-01T00:00:00.000Z"));

    // The oldest brain-*.db still held is newer than both ancient tags, so the older tag is the
    // only artifact from before that boundary -- rule 5 must keep it regardless of the quarterly tier.
    fs.writeFileSync(path.join(dir, "brain-2015-06-01.db"), "x");

    pruneSnapshots(dir, NOW);

    expect(fs.existsSync(path.join(dir, quarterWinner))).toBe(true); // via the quarterly tier
    expect(fs.existsSync(path.join(dir, protectedByRule5))).toBe(true); // via rule 5, which overrides it
  });

  it("sweeps a pre-*.db.tmp left behind by a killed vacuum, once it is old enough", () => {
    const tmp = "pre-0016_commitments-2026-09-25T12-00-00-000Z.db.tmp";
    const p = path.join(dir, tmp);
    fs.writeFileSync(p, "partial vacuum output");
    const old = new Date(NOW.getTime() - 2 * 60 * 60 * 1000); // 2 hours before `now`
    fs.utimesSync(p, old, old);

    pruneSnapshots(dir, NOW);

    expect(fs.existsSync(p)).toBe(false);
  });

  it("does not sweep a pre-*.db.tmp younger than the age floor -- it might be a vacuum in flight", () => {
    const tmp = "pre-0016_commitments-2026-09-25T12-00-00-000Z.db.tmp";
    const p = path.join(dir, tmp);
    fs.writeFileSync(p, "partial vacuum output");
    const recent = new Date(NOW.getTime() - 5 * 60 * 1000); // 5 minutes before `now`
    fs.utimesSync(p, recent, recent);

    pruneSnapshots(dir, NOW);

    expect(fs.existsSync(p)).toBe(true);
  });

  it("does not throw on a directory shaped like a pre-*.db.tmp, and does not touch it", () => {
    const p = path.join(dir, "pre-0016_commitments-2026-09-25T12-00-00-000Z.db.tmp");
    fs.mkdirSync(p);
    const old = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
    fs.utimesSync(p, old, old);

    expect(() => pruneSnapshots(dir, NOW)).not.toThrow();
    expect(fs.existsSync(p)).toBe(true);
  });

  it("does not throw on a directory shaped like a snapshot this job owns, and does not touch it", () => {
    // Ten recent real snapshots fill the floor and the twelve-month window, and a same-quarter,
    // newer real snapshot wins that quarter's slot -- so the directory below is protected by
    // nothing and the deletion loop actually reaches it.
    for (let i = 1; i <= 10; i++) write(`recent${i}`, new Date(NOW.getTime() - i * 10 * 86_400_000));
    write("ancient-newer", new Date("2010-02-01T00:00:00.000Z"));

    const p = path.join(dir, snapshotName("ancient-older-trap", new Date("2010-01-01T00:00:00.000Z")));
    fs.mkdirSync(p);

    expect(() => pruneSnapshots(dir, NOW)).not.toThrow();
    expect(fs.existsSync(p)).toBe(true);
  });

  it("does nothing when the directory does not exist", () => {
    expect(() => pruneSnapshots(path.join(dir, "nope"), NOW)).not.toThrow();
  });
});

describe("sweepSidecars", () => {
  let root: string;
  let dir: string;
  beforeEach(() => {
    root = makeTempDataDir();
    dir = path.join(root, "backups");
    fs.mkdirSync(dir, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("sweeps the -wal, -shm, and -journal files of backups this job owns", () => {
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

  it("leaves a database a restore set aside alone, sidecars included", () => {
    // brain-replaced-<stamp>.db is what Task 3's restore moves the current database aside to --
    // it can legitimately carry committed, not-yet-checkpointed rows in its own -wal, and it is
    // not a name this job wrote, so it must never match.
    fs.writeFileSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db"), "a database a restore set aside");
    fs.writeFileSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db-wal"), "rows not yet checkpointed");
    fs.writeFileSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db-shm"), "shm");

    expect(sweepSidecars(dir)).toBe(0);
    expect(fs.existsSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db-wal"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "brain-replaced-2026-09-25T00-00-00-000Z.db-shm"))).toBe(true);
  });

  it("leaves ordinary files alone even when their name happens to end in a swept suffix", () => {
    fs.writeFileSync(path.join(dir, "meeting-2026-09-01-journal"), "somebody's notes");
    fs.writeFileSync(path.join(dir, "my-shm"), "not a sidecar");
    fs.writeFileSync(path.join(dir, "notes-wal-mart-receipt.db"), "merely contains the string wal");

    expect(sweepSidecars(dir)).toBe(0);
    expect(fs.existsSync(path.join(dir, "meeting-2026-09-01-journal"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "my-shm"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "notes-wal-mart-receipt.db"))).toBe(true);
  });

  it("NEW-6: leaves a sidecar alone when dateOf would refuse to judge its base name", () => {
    // brain-9999-99-99.db matches the digits-only NAME_RE pattern but is not a real calendar
    // date, so dateOf(base) returns null and pruneBackups would never treat brain-9999-99-99.db
    // itself as an owned backup -- sweepSidecars has to agree, not sweep its sidecar anyway.
    fs.writeFileSync(path.join(dir, "brain-9999-99-99.db-wal"), "x");
    fs.writeFileSync(path.join(dir, "brain-2026-09-24.db-wal"), "a real sidecar"); // control: still swept

    expect(sweepSidecars(dir)).toBe(1);
    expect(fs.existsSync(path.join(dir, "brain-9999-99-99.db-wal"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "brain-2026-09-24.db-wal"))).toBe(false);
  });

  it("refuses to sweep the data directory itself", () => {
    // dir here IS the data directory (no "backups" subdirectory), which is where a live
    // database's own -wal/-shm actually live.
    const liveDir = root;
    fs.writeFileSync(path.join(liveDir, "brain.db-wal"), "rows a live writer has not checkpointed yet");

    expect(sweepSidecars(liveDir)).toBe(0);
    expect(fs.existsSync(path.join(liveDir, "brain.db-wal"))).toBe(true);
  });

  it("does not throw on a directory whose name is an owned base plus a swept suffix, and does not touch it", () => {
    // brain-2026-09-24.db-journal is a name the pattern *does* match -- an owned base with a real
    // date -- so this is the actual EISDIR trap, unlike a name the base check would reject anyway.
    const trap = path.join(dir, "brain-2026-09-24.db-journal");
    fs.mkdirSync(trap);
    fs.writeFileSync(path.join(trap, "keepme.txt"), "x");

    expect(() => sweepSidecars(dir)).not.toThrow();
    expect(fs.existsSync(trap)).toBe(true);
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
