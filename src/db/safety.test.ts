import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeTestDb, makeTempDataDir, type TestDb } from "@/test/db";
import { openDatabase } from "@/db/client";
import { backupsDir } from "@/jobs/handlers/backup";
import { verifyDatabaseFile, checkOpenDatabase, pendingMigrations, snapshotBeforeMigrate, SNAPSHOT_PREFIX } from "./safety";

const FOLDER = path.join(process.cwd(), "drizzle");

function journalTags(): string[] {
  const journal = JSON.parse(fs.readFileSync(path.join(FOLDER, "meta", "_journal.json"), "utf8")) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);
}

let t: TestDb;
afterEach(() => t?.cleanup());

describe("verifyDatabaseFile", () => {
  it("passes a database that is sound", () => {
    t = makeTestDb();
    expect(verifyDatabaseFile(t.db.$client.name)).toMatchObject({ ok: true, problems: [] });
  });

  it("fails a file that is not a database at all, without throwing", () => {
    t = makeTestDb();
    const junk = path.join(t.dir, "junk.db");
    fs.writeFileSync(junk, "this is not a database");
    const r = verifyDatabaseFile(junk);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/not a database|file is encrypted/i);
  });

  it("fails a database truncated halfway", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    t.db.$client.pragma("wal_checkpoint(TRUNCATE)");
    const truncated = path.join(t.dir, "truncated.db");
    const full = fs.readFileSync(file);
    fs.writeFileSync(truncated, full.subarray(0, Math.floor(full.length / 2)));
    const r = verifyDatabaseFile(truncated);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it("fails a file that does not exist", () => {
    t = makeTestDb();
    const r = verifyDatabaseFile(path.join(t.dir, "nope.db"));
    expect(r.ok).toBe(false);
  });

  it("leaves the source directory byte-identical after a verify, database still open", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const dir = path.dirname(file);
    const before = fs.readdirSync(dir).sort();
    expect(verifyDatabaseFile(file)).toMatchObject({ ok: true });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });

  it("leaves the source directory byte-identical after a verify, on a cold file with no sidecars", () => {
    // The vulnerable case: no -wal/-shm exist before the call, which is exactly the shape a
    // read-only open would otherwise create them for and (in an earlier, broken version of this
    // function) delete afterward -- unsafely, if a concurrent writer's own -wal had appeared in
    // between. Verifying a copy means this directory is never touched at all, regardless.
    const dir = makeTempDataDir();
    const file = path.join(dir, "cold.db");
    openDatabase(file).$client.close(); // WAL mode's last-connection close checkpoints and removes -wal/-shm
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
    expect(fs.existsSync(`${file}-shm`)).toBe(false);

    const before = fs.readdirSync(dir).sort();
    expect(verifyDatabaseFile(file)).toMatchObject({ ok: true });
    expect(fs.readdirSync(dir).sort()).toEqual(before);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("checkOpenDatabase", () => {
  it("passes a connection that is already open", () => {
    t = makeTestDb();
    expect(checkOpenDatabase(t.db)).toMatchObject({ ok: true, problems: [] });
  });

  it("fails when a foreign key points at nothing", () => {
    t = makeTestDb();
    const now = new Date().toISOString();
    t.db.$client.pragma("foreign_keys = OFF");
    t.db.$client
      .prepare("INSERT INTO items (type, title, container_id, created_at, updated_at) VALUES ('note', 'T', 999999, ?, ?)")
      .run(now, now);
    t.db.$client.pragma("foreign_keys = ON");
    const r = checkOpenDatabase(t.db);
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBeGreaterThan(0);
  });
});

describe("pendingMigrations", () => {
  it("names the migrations a database has not applied", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const tags = journalTags();
    const lastTag = tags[tags.length - 1];
    t.db.run(`delete from __drizzle_migrations where created_at = (select max(created_at) from __drizzle_migrations)`);
    expect(pendingMigrations(file, FOLDER)).toEqual([lastTag]);
  });

  it("has nothing pending against a database that is up to date", () => {
    t = makeTestDb();
    expect(pendingMigrations(t.db.$client.name, FOLDER)).toEqual([]);
  });

  it("treats a database with no migrations table as entirely pending", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    t.db.run(`drop table __drizzle_migrations`);
    expect(pendingMigrations(file, FOLDER)).toEqual(journalTags());
  });

  it("treats a database that does not exist yet as entirely pending", () => {
    t = makeTestDb();
    expect(pendingMigrations(path.join(t.dir, "nope.db"), FOLDER)).toEqual(journalTags());
  });
});

describe("snapshotBeforeMigrate", () => {
  it("snapshots before a migration and verifies what it wrote", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const now = new Date("2026-09-25T12:00:00.000Z");
    const at = snapshotBeforeMigrate(file, "0016_commitments", now);
    expect(at).not.toBeNull();
    expect(path.basename(at!).startsWith(`${SNAPSHOT_PREFIX}0016_commitments-`)).toBe(true);
    expect(fs.existsSync(at!)).toBe(true);
    expect(verifyDatabaseFile(at!)).toMatchObject({ ok: true, problems: [] });
  });

  it("copies the source's committed rows into the snapshot, including ones still only in the WAL", () => {
    // This is what would have caught the checkpoint-return-value bug: a row committed but not
    // yet checkpointed has to survive the copy, not just an integrity_check on whatever the
    // checkpoint happened to move.
    t = makeTestDb();
    const now = new Date().toISOString();
    t.db.$client.prepare("INSERT INTO items (type, title, created_at, updated_at) VALUES ('note', 'still in the wal', ?, ?)").run(now, now);
    const file = t.db.$client.name;
    const at = snapshotBeforeMigrate(file, "0016_commitments", new Date("2026-09-25T12:00:00.000Z"))!;
    const snap = new Database(at, { readonly: true });
    try {
      expect(snap.prepare("SELECT title FROM items").all()).toEqual(t.db.$client.prepare("SELECT title FROM items").all());
    } finally {
      snap.close();
    }
  });

  it("leaves the snapshot as one self-contained file, with no sidecars beside it", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const at = snapshotBeforeMigrate(file, "0016_commitments", new Date("2026-09-25T12:00:00.000Z"))!;
    const dir = path.dirname(at);
    const siblings = fs.readdirSync(dir).filter((n) => n.startsWith(path.basename(at)));
    expect(siblings).toEqual([path.basename(at)]);
  });

  it("answers null on a first run, when there is no database to protect", () => {
    t = makeTestDb();
    expect(snapshotBeforeMigrate(path.join(t.dir, "nope.db"), "0000_init")).toBeNull();
  });

  it("discards a snapshot that fails its own verification, and reports it", () => {
    // A source with no "items" table is sound SQLite but fails verifyDatabaseFile's core-table
    // read -- a real failure reached through the public API, not a mocked one.
    const dir = makeTempDataDir();
    const file = path.join(dir, "foreign.db");
    const raw = new Database(file);
    raw.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    raw.close();

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const at = snapshotBeforeMigrate(file, "0000_init", new Date("2026-09-25T12:00:00.000Z"));
    expect(at).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    const leftover = fs.existsSync(backupsDir()) ? fs.readdirSync(backupsDir()).filter((n) => n.startsWith("pre-0000_init-")) : [];
    expect(leftover).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
