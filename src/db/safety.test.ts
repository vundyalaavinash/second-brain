import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
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

  it("opens read-only, so checking a backup cannot leave a -wal beside it", () => {
    t = makeTestDb();
    const file = t.db.$client.name;
    const dir = path.dirname(file);
    const before = fs.readdirSync(dir);
    verifyDatabaseFile(file);
    expect(fs.readdirSync(dir)).toEqual(before);
  });
});

describe("checkOpenDatabase", () => {
  it("passes a connection that is already open", () => {
    t = makeTestDb();
    expect(checkOpenDatabase(t.db)).toMatchObject({ ok: true, problems: [] });
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
});
