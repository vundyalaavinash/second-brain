import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, it, expect, afterEach, vi } from "vitest";
import { makeTestDb, makeTempDataDir, type TestDb } from "@/test/db";
import { openDatabase } from "@/db/client";
import { backupsDir } from "@/lib/paths";
import { createItem, rechunkItem } from "@/domain/items";
import { createFakeEmbedProvider } from "@/providers/embed/fake";
import { createEmbedHandler } from "@/jobs/handlers/embed";
import { enqueueJob } from "@/jobs/queue";
import { verifyDatabaseFile, checkOpenDatabase, pendingMigrations, snapshotBeforeMigrate, SNAPSHOT_PREFIX } from "./safety";

const FOLDER = path.join(process.cwd(), "drizzle");

/** A real chunk with real text and a real vector, so the damaged-index tests below have an actual
 * index to damage -- an empty `chunks` table skips both probes entirely (by design: no chunks is
 * the owner's actual state today, and probing an empty index would be a false failure waiting to
 * happen). */
async function seedChunk(t: TestDb): Promise<void> {
  const item = createItem(t.db, { type: "note", title: "T", body: "Tomatoes need full sun and regular water in the garden." });
  rechunkItem(t.db, item.id);
  const embed = createFakeEmbedProvider();
  const handler = createEmbedHandler({ db: t.db, embed });
  await handler(enqueueJob(t.db, "embed", { itemId: item.id }, item.id));
}

/** A real chunk with real text but never embedded -- the state under `SB_EMBED=off`, after an
 * embed-provider failure, or simply between ingest and the (asynchronous, separate) embed job
 * running. `chunks_fts` is populated regardless, by the same trigger that inserts the `chunks`
 * row; `chunks_vec` is not. */
function seedChunkWithoutVector(t: TestDb): void {
  const item = createItem(t.db, { type: "note", title: "T", body: "Tomatoes need full sun and regular water in the garden." });
  rechunkItem(t.db, item.id);
}

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

  it("N5: fails a database whose vector index is damaged, even though row counts and integrity_check stay clean", async () => {
    // A plain integrity_check never walks vec0's shadow tables, and the old version of this
    // function opened its copy without sqlite-vec loaded at all, so a broken chunks_vec would
    // report "sound" right up until someone actually tried to search. Zero the shadow table's
    // vector blobs in place -- destroys nearest-neighbour search (null distances, wrong rowids)
    // without changing any row count or failing integrity_check -- and prove verify now notices.
    t = makeTestDb();
    await seedChunk(t);
    const file = t.db.$client.name;
    const rows = t.db.$client.prepare("SELECT rowid, length(vectors) AS len FROM chunks_vec_vector_chunks00").all() as {
      rowid: number;
      len: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    const zero = t.db.$client.prepare("UPDATE chunks_vec_vector_chunks00 SET vectors = zeroblob(?) WHERE rowid = ?");
    for (const row of rows) zero.run(row.len, row.rowid);

    const r = verifyDatabaseFile(file);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/chunks_vec/);
  });

  it("N5: fails a database whose full-text index is empty even though the content table is not", async () => {
    // chunks_fts is an external-content table (content='chunks'), so a plain count(*) on it reads
    // the content table, not the index -- a real gap this measures: emptying only the index via
    // the same 'delete' command the app's own chunks_ad trigger uses, leaving `chunks` itself
    // fully populated, so the two really can disagree.
    t = makeTestDb();
    await seedChunk(t);
    const file = t.db.$client.name;
    const rows = t.db.$client.prepare("SELECT id, text FROM chunks").all() as { id: number; text: string }[];
    expect(rows.length).toBeGreaterThan(0);
    const del = t.db.$client.prepare("INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', ?, ?)");
    for (const row of rows) del.run(row.id, row.text);

    const r = verifyDatabaseFile(file);
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toMatch(/chunks_fts/);
  });

  it("verifies a database with real chunks sound when neither index is damaged", async () => {
    t = makeTestDb();
    await seedChunk(t);
    const r = verifyDatabaseFile(t.db.$client.name);
    expect(r).toMatchObject({ ok: true, problems: [] });
  });

  it("NEW-1: verifies ok when the database has chunks but no vectors yet", () => {
    // The permanent state under SB_EMBED=off, after any embed-provider failure, or simply in the
    // window between ingesting something and the separate embed job running -- the owner's very
    // first capture is in this state. A gate keyed on `chunks` alone (rather than `chunks_vec`
    // itself) would fail every verification here and delete every nightly backup, forever, on a
    // database with nothing wrong with it. `seedChunk` always embeds, so it cannot catch this;
    // this uses `seedChunkWithoutVector`, which deliberately does not.
    t = makeTestDb();
    seedChunkWithoutVector(t);
    const vectorCount = (t.db.$client.prepare("SELECT count(*) AS n FROM chunks_vec").get() as { n: number }).n;
    expect(vectorCount).toBe(0); // confirms the fixture actually reaches the state under test
    const r = verifyDatabaseFile(t.db.$client.name);
    expect(r).toMatchObject({ ok: true, problems: [] });
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

  it("N1: an interruption before the vacuum's temp file is renamed into place leaves nothing shaped like a recovery point", () => {
    // The vacuum writes to a `.tmp` name and only a rename makes it `pre-*.db`; that rename is
    // the last thing the function does, so making it fail is the strongest place to prove the
    // property -- if nothing shaped like a snapshot exists when only the very last step failed,
    // nothing shaped like one can exist for a real kill earlier in the vacuum either.
    t = makeTestDb();
    const file = t.db.$client.name;
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("simulated interruption between the vacuum completing and the rename");
    });
    try {
      expect(() => snapshotBeforeMigrate(file, "0016_commitments", new Date("2026-09-25T12:00:00.000Z"))).toThrow();
    } finally {
      renameSpy.mockRestore();
    }

    const dir = backupsDir();
    const looksLikeASnapshot = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^pre-.*\.db$/.test(n)) : [];
    expect(looksLikeASnapshot).toEqual([]);
  });
});
