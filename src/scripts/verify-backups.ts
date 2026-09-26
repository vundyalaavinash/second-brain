/**
 * Walks the backups directory and verifies every `.db` file in it -- nightly `brain-*.db`
 * backups and `pre-*.db` pre-migration snapshots alike -- through the exact same
 * `verifyDatabaseFile` the backup job runs on what it just wrote. Prints one line per file: its
 * name, when it was written, its size, and whether it is sound, or the first problem found.
 *
 * This is `scripts/brain.sh verify`. Design's rule is "a backup you have not opened is a
 * rumour" -- this is the one place in the whole design that answers "are mine real", so it exits
 * non-zero whenever there is reason not to trust the answer: a missing backups directory, a
 * directory with nothing in it, or any file that fails its check. Silence on stdout never means
 * "fine" here -- every file gets its own line either way.
 *
 * A single filename argument switches to checking just that one file instead of walking the
 * directory -- this is what `scripts/brain.sh restore <file>` calls for its own step 2, "verify
 * it before touching anything". The name must resolve inside the backups directory; anything
 * that would land outside it -- an absolute path elsewhere, a `../` escape, or a symlink inside
 * the directory pointing anywhere else on disk -- is refused rather than opened, matching
 * restore's own step 1.
 */
import fs from "node:fs";
import path from "node:path";
import { verifyDatabaseFile } from "@/db/safety";
import { backupsDir } from "@/lib/paths";

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** Thrown by `resolveInBackups` for a name that would resolve outside the backups directory, so
 * the caller decides how to report it rather than this function reaching for `process.exit`
 * itself -- which would make it untestable, since a thrown `process.exit` kills the test runner. */
export class OutsideBackupsDirError extends Error {}

/** Thrown by `resolveInBackups` when `name` does not name anything that exists (including a
 * symlink whose target does not exist). */
export class NoSuchBackupError extends Error {}

/** Resolves `name` against the backups directory `dir` -- which must itself already exist --
 * throwing `OutsideBackupsDirError` for anything that would land outside it and
 * `NoSuchBackupError` for anything that does not exist at all. Uses `fs.realpathSync`, not
 * `path.resolve`: `path.resolve` is purely textual, so a symlink sitting inside the backups
 * directory but pointing anywhere else on disk would pass the prefix check untouched and then be
 * opened and copied by `verifyDatabaseFile` -- reproduced, `ln -s /etc/passwd backups/sneak.db`
 * was read and reported as an unsound database rather than refused. `realpathSync` resolves the
 * link (and the backups directory itself, in case it is reached through one) before the prefix
 * check runs, so the check is against where the bytes actually come from, not the name used to
 * ask for them -- matching what `resolve_backup_file` already does on the bash side with
 * `realpath`. */
export function resolveInBackups(dir: string, name: string): string {
  const dirReal = fs.realpathSync(dir);
  const dirWithSep = dirReal.endsWith(path.sep) ? dirReal : dirReal + path.sep;
  const candidate = path.isAbsolute(name) ? name : path.join(dirReal, name);
  let resolved: string;
  try {
    resolved = fs.realpathSync(candidate);
  } catch {
    throw new NoSuchBackupError(`no such backup: ${name}`);
  }
  if (resolved !== dirReal && !resolved.startsWith(dirWithSep)) {
    throw new OutsideBackupsDirError(`"${name}" is outside the backups directory (${dir})`);
  }
  return resolved;
}

/** A regular file only, never a symlink either way it might resolve -- `lstatSync`, not
 * `statSync`, matching the precedent already set in `jobs/handlers/backup.ts`'s own
 * `isRegularFile`. Used to keep the directory walk below from opening a symlink someone left in
 * the backups directory the same way `resolveInBackups` refuses one by name. */
function isRegularFile(p: string): boolean {
  try {
    return fs.lstatSync(p).isFile();
  } catch {
    return false;
  }
}

/** Prints one line for `file` -- name, mtime, size, sound or the first problem -- and reports
 * whether it verified sound. */
export function verifyOne(file: string): boolean {
  const stat = fs.statSync(file);
  const check = verifyDatabaseFile(file);
  const status = check.ok ? "sound" : `UNSOUND: ${check.problems[0] ?? "failed"}`;
  console.log(`${path.basename(file)}  ${stat.mtime.toISOString()}  ${formatSize(stat.size)}  ${status}`);
  return check.ok;
}

function main(): void {
  const dir = backupsDir();

  if (!fs.existsSync(dir)) {
    console.error(`no backups directory at ${dir}`);
    process.exit(1);
  }

  const arg = process.argv[2];
  if (arg) {
    let file: string;
    try {
      file = resolveInBackups(dir, arg);
    } catch (err) {
      if (err instanceof OutsideBackupsDirError) {
        console.error(`refusing: ${err.message}`);
      } else {
        console.error(err instanceof Error ? err.message : String(err));
      }
      process.exit(1);
    }
    process.exit(verifyOne(file) ? 0 : 1);
  }

  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db")) // brain-*.db and pre-*.db; never a *.db.tmp half-vacuum
    .filter((name) => isRegularFile(path.join(dir, name))) // never follow a symlink here either
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // newest name first

  if (names.length === 0) {
    console.log(`no backups found in ${dir}`);
    process.exit(1);
  }

  let allSound = true;
  for (const name of names) {
    if (!verifyOne(path.join(dir, name))) allSound = false;
  }
  process.exit(allSound ? 0 : 1);
}

// Only run as a CLI, not on import -- lets a test import the exported pieces above and exercise
// them directly, without a real invocation's `process.exit` calls tearing down the test process.
if (import.meta.url === `file://${process.argv[1]}`) main();
