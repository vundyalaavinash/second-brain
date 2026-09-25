# Nothing Is Ever Lost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every backup is proven openable, every migration is preceded by a snapshot, and there is one documented command that puts a known-good database back.

**Architecture:** A new `src/db/safety.ts` owns the three checks — verify a file, check the open database, snapshot before migrating — and `openDatabase` calls the snapshot one only when migrations are actually pending. The existing nightly backup job gains verification and a three-tier prune. `scripts/brain.sh` gains `backup`, `verify` and `restore`, the last written so that nothing it replaces is ever deleted.

**Tech Stack:** Next.js 16 App Router, better-sqlite3 (its `.backup()` and `pragma`), Drizzle's migrator, Vitest 5, bash for the operator commands.

**Spec:** `docs/superpowers/specs/2026-09-25-nothing-is-ever-lost-design.md`

## Global Constraints

- **A backup you have not opened is a rumour.** Every file this plan writes is opened and checked before it is counted as a backup. A file that fails is deleted and the failure is loud.
- **Nothing destructive without keeping what it replaces.** Restore moves the current database aside; it never deletes it.
- **No automatic repair, ever.** A failed integrity check logs, surfaces, and stops. A program that fixes its own corruption unattended turns a recoverable problem into an unrecoverable one.
- Tests never touch the network and never depend on the real clock or the machine's timezone. Every function needing the clock takes `now` with a default.
- Tests that write files use a temp directory and clean it up; `makeTestDb()` is the existing helper and it already does this.
- Retention: 7 daily, 4 weekly, 6 monthly, all exported constants.
- **Do not run `next build`, `next start`, or `scripts/brain.sh`** — the checkout is the live production directory. Bash changes are verified by reading and by unit-testing the TypeScript they call, not by running the script against the real data directory.
- Commit trailers on every commit:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01QYJrz3x3KjYd5nuXomA55j`

---

## File structure

| File | Responsibility |
|---|---|
| `src/db/safety.ts` (+ test) | `verifyDatabaseFile`, `checkOpenDatabase`, `snapshotBeforeMigrate`, `pendingMigrations` |
| `src/db/client.ts` | snapshot when migrations are pending; check after they run |
| `src/jobs/handlers/backup.ts` (+ test) | verify what it wrote; three-tier prune; sweep orphan sidecars |
| `src/server/boot.ts` (+ test) | the boot check, logged and recorded |
| `src/lib/safety-status.ts` (+ test), `src/app/api/safety/route.ts` | what the app can say about its own state |
| `src/components/activity/safety-line.tsx` (+ test) | one line where it will be seen |
| `scripts/brain.sh` | `backup`, `verify`, `restore` |
| `src/scripts/verify-backups.ts`, `src/scripts/take-backup.ts` | what the shell commands call |
| `README.md`, `docs/superpowers/runbook.md` | the procedure, written down before it is needed |

---

### Task 1: The three checks

**Files:**
- Create: `src/db/safety.ts`, `src/db/safety.test.ts`
- Modify: `src/db/client.ts`

**Interfaces:**
- Produces:
  - `export interface CheckResult { ok: boolean; problems: string[] }`
  - `verifyDatabaseFile(file: string): CheckResult` — opens the file **read-only**, runs `integrity_check` and `foreign_key_check`, confirms a core table is readable. Any throw is a failed check, never a thrown error to the caller.
  - `checkOpenDatabase(db: DB): CheckResult` — the same two pragmas on a connection that is already open.
  - `pendingMigrations(file: string, folder: string): string[]` — the migration tags in the journal that this database has not applied.
  - `snapshotBeforeMigrate(file: string, tag: string, now?: Date): string | null` — copies the database to the backups directory as `pre-<tag>-<stamp>.db`, verifies it, and answers the path. `null` when the source does not exist yet, which is a first run and has nothing to protect.
  - `export const SNAPSHOT_PREFIX = "pre-";`

- [ ] **Step 1: Write the failing test**

`src/db/safety.test.ts`. The cases that matter are the unhappy ones, because the happy path is what everyone tests and the unhappy path is what you are actually buying:

```ts
it("passes a database that is sound", () => {
  const t = makeTestDb();
  expect(verifyDatabaseFile(t.file)).toMatchObject({ ok: true, problems: [] });
});

it("fails a file that is not a database at all, without throwing", () => {
  fs.writeFileSync(junk, "this is not a database");
  const r = verifyDatabaseFile(junk);
  expect(r.ok).toBe(false);
  expect(r.problems.join(" ")).toMatch(/not a database|file is encrypted/i);
});

it("fails a database truncated halfway", () => {
  // Copy a real database, truncate it to half its length, and check.
  // This is the realistic corruption: a copy interrupted partway.
});

it("fails a file that does not exist", () => {});

it("opens read-only, so checking a backup cannot leave a -wal beside it", () => {
  // The bug that is already on disk: something opened a backup read-write and left
  // sidecars that the prune's pattern cannot see. Assert no -wal or -shm appears.
  const before = fs.readdirSync(dir);
  verifyDatabaseFile(file);
  expect(fs.readdirSync(dir)).toEqual(before);
});

it("names the migrations a database has not applied", () => {});
it("has nothing pending against a database that is up to date", () => {});

it("snapshots before a migration and verifies what it wrote", () => {});
it("answers null on a first run, when there is no database to protect", () => {});
```

- [ ] **Step 2: Run to verify it fails, then write the module**

`verifyDatabaseFile` must open with better-sqlite3's `{ readonly: true }` **and** `fileMustExist: true`, wrap everything in try/catch, and never leave a connection open — `finally { db.close(); }`. The read-only test above exists because the current state of the backups directory proves this is not hypothetical.

`pendingMigrations` reads drizzle's journal from the folder and the `__drizzle_migrations` table from the file, and returns the difference. When the table does not exist, everything is pending.

- [ ] **Step 3: Wire it into `openDatabase`**

```ts
export function openDatabase(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const folder = path.join(process.cwd(), "drizzle");
  // Only when there is something to apply: this runs on every open, and a snapshot per open
  // would be both slow and pointless. A bad migration is the one moment last night's backup
  // is not good enough, because it costs the day's work.
  const pending = file === ":memory:" ? [] : pendingMigrations(file, folder);
  if (pending.length > 0) {
    const at = snapshotBeforeMigrate(file, pending[0]);
    if (at) console.log(`[db] snapshot before ${pending[0]}: ${at}`);
  }
  … open, pragmas, vec, migrate …
  if (pending.length > 0) {
    const check = checkOpenDatabase(db);
    // A migration that completes and leaves the database unsound is worse than one that
    // fails outright, because it looks like success.
    if (!check.ok) console.error(`[db] integrity check failed after migrating: ${check.problems.join("; ")}`);
  }
  return db;
}
```

A `:memory:` database has nothing to snapshot, and the test suite opens hundreds of them — make sure the fast path really is fast, and assert it with a test that a memory database takes no snapshot.

- [ ] **Step 4: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus `TZ=Pacific/Midway npm test` where the only failures are the two known pre-existing files.

```bash
git commit -m "feat(safety): open a backup before trusting it, and snapshot before every migration

<trailers>"
```

---

### Task 2: A backup that proves itself

**Files:**
- Modify: `src/jobs/handlers/backup.ts` (+ test), `src/server/boot.ts` (+ test)

**Interfaces:**
- Produces: `export const KEEP_DAILY = 7; export const KEEP_WEEKLY = 4; export const KEEP_MONTHLY = 6;` and `sweepSidecars(dir: string): number`.

- [ ] **Step 1: Write the failing test**

```ts
it("deletes what it wrote when the file will not open, and says so", async () => {
  // Stub the backup to produce a corrupt file; assert it is gone afterwards and that the
  // previous backups are untouched. A bad file that looks like a backup is worse than a gap,
  // because it is the one you would reach for.
});

it("keeps the newest of each tier rather than only the newest seven", async () => {
  // Seed 60 days of files; assert 7 daily + 4 weekly + 6 monthly survive, and that the
  // weekly and monthly kept are the ones the rule names, not whatever happened to be left.
});

it("sweeps the -wal and -shm files the old pattern could not see", () => {
  // This is on disk right now. Seed brain-2026-09-24.db-wal beside a real backup and assert
  // it is gone, and that a legitimate .db is not.
});

it("leaves an attachments backup alone when there are no attachments", () => {});
```

- [ ] **Step 2: Run to verify it fails, then build it**

Verification runs on the file the job just wrote, through `verifyDatabaseFile`. On failure: delete the file, do **not** prune (the older backups are now the only ones there are), and log at error level with the word "backup" in it so it is greppable.

The three-tier prune keeps, by name: the newest 7 daily; then of what remains the newest of each ISO week, up to 4; then the newest of each month, up to 6. A file kept by a higher tier is not also counted by a lower one.

`sweepSidecars` removes any `*.db-wal` or `*.db-shm` in the backups directory. It only ever touches those two suffixes and it is the only thing in this plan permitted to delete a file it did not write.

- [ ] **Step 3: Boot checks the database**

`boot()` runs `checkOpenDatabase` once and logs the result. On failure it logs loudly and records it for §7's status; **it does not attempt anything**. Add a test that a failing check does not throw out of `boot` and does not stop the worker starting — a database that fails a foreign-key check is still a database you want to be able to open and read.

- [ ] **Step 4: Run the suite and commit**

```bash
git commit -m "feat(safety): a backup is verified, tiered, and tidies the sidecars nobody could see

<trailers>"
```

---

### Task 3: Putting it back

**Files:**
- Create: `src/scripts/verify-backups.ts`, `src/scripts/take-backup.ts`
- Modify: `scripts/brain.sh`, `package.json`, `README.md`
- Create: `docs/superpowers/runbook.md`

- [ ] **Step 1: The two node scripts**

`verify-backups.ts` walks the backups directory, calls `verifyDatabaseFile` on each `.db`, and prints one line per file: date, size, and sound or the first problem. It exits non-zero if any file fails, so it can be used as a check rather than only read.

`take-backup.ts` opens the database, runs the backup job's own code path, and reports where the file went and whether it verified. It must reuse the handler rather than reimplementing it — two ways to take a backup is how one of them rots.

- [ ] **Step 2: `brain.sh backup` and `verify`**

Thin wrappers over the two scripts, following the style of the commands already in the file. Read `cmd_status` first and match it.

- [ ] **Step 3: `brain.sh restore`, written carefully**

This is the command that runs on the worst day, so it is the one that gets the care.

```
restore                 lists what is available, sound or not, and stops
restore <file>          the full procedure
```

The procedure, in this order, and each step announced as it happens:

1. Resolve the file. Refuse anything outside the backups directory.
2. **Verify it before touching anything.** Refuse an unsound backup outright, naming the problem.
3. Stop the server and wait for it to actually be down.
4. Move the current database and its `-wal` and `-shm` aside to `brain-replaced-<stamp>.db`. **Move, never delete.**
5. Copy the backup into place.
6. Restore the attachments directory for that date when one exists; say so when one does not, rather than silently leaving the current attachments beside a restored database.
7. Start the server, wait for it to answer, and run the boot check.
8. Print where the replaced database went, as a path that could be pasted back.

Guard rails: refuse to run if the server cannot be stopped; refuse if the backups directory is missing; and require a typed `restore` confirmation before step 4, because steps 1 to 3 are reversible and step 4 onward changes what is on disk.

- [ ] **Step 4: The runbook**

`docs/superpowers/runbook.md`, written to be read by someone who is worried. Short, in order, no prose before the first command:

- The app will not start.
- The app starts but the data looks wrong.
- A migration went badly.
- I want to go back to yesterday.
- How do I check my backups are real?
- Where does everything live on disk?

Each answer is the command and what it will print. Name the one-disk limitation from spec §10 plainly at the end.

- [ ] **Step 5: README and commit**

A short section pointing at the runbook and saying, in a sentence, what the guarantee actually is: daily verified backups kept for six months, a snapshot before every migration, and one command to go back.

Run: `npm test && npx tsc --noEmit && npm run lint`.

```bash
git commit -m "feat(safety): backup, verify and restore, and the runbook for the day you need them

<trailers>"
```

---

### Task 4: The app says what it knows

**Files:**
- Create: `src/lib/safety-status.ts` (+ test), `src/app/api/safety/route.ts`, `src/components/activity/safety-line.tsx` (+ test)
- Modify: the Activity page

**Interfaces:**
- Produces: `safetyStatus(db, now?): { lastBackupAt: string | null; verified: boolean; recoveryPoints: number; oldest: string | null; integrity: CheckResult }`

- [ ] **Step 1: Write the failing test**

```ts
it("says nothing is wrong in one line when nothing is wrong", () => {});
it("says so when the newest backup is older than two days", () => {});
it("says so when the last backup failed to verify", () => {});
it("says so when the boot check found a problem, and names it", () => {});
it("counts how far back the recovery points reach", () => {});
```

- [ ] **Step 2: Build it**

One line on the Activity page: "Backed up 3 hours ago, verified. 17 recovery points, back to 12 April." When something is wrong the line says what and names the command from the runbook. `text-fg-muted` when fine; the problem case is a sentence, not a colour.

- [ ] **Step 3: Run the suite and commit**

Run: `npm test && npx tsc --noEmit && npm run lint`, plus the `TZ` run.

```bash
git commit -m "feat(safety): the app says when it cannot vouch for itself

<trailers>"
```
