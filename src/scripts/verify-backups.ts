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
 * that would land outside it (an absolute path elsewhere, a `../` escape) is refused rather than
 * opened, matching restore's own step 1.
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

/** Resolves `name` against the backups directory `dir`, throwing `OutsideBackupsDirError` for
 * anything that would land outside it -- an absolute path elsewhere, or a `../` escape. */
export function resolveInBackups(dir: string, name: string): string {
  const candidate = path.isAbsolute(name) ? name : path.join(dir, name);
  const resolved = path.resolve(candidate);
  const dirWithSep = dir.endsWith(path.sep) ? dir : dir + path.sep;
  if (!resolved.startsWith(dirWithSep)) {
    throw new OutsideBackupsDirError(`"${name}" is outside the backups directory (${dir})`);
  }
  return resolved;
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
  const arg = process.argv[2];

  if (arg) {
    let file: string;
    try {
      file = resolveInBackups(dir, arg);
    } catch (err) {
      console.error(`refusing: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    if (!fs.existsSync(file)) {
      console.error(`no such backup: ${file}`);
      process.exit(1);
    }
    process.exit(verifyOne(file) ? 0 : 1);
  }

  if (!fs.existsSync(dir)) {
    console.error(`no backups directory at ${dir}`);
    process.exit(1);
  }

  const names = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".db")) // brain-*.db and pre-*.db; never a *.db.tmp half-vacuum
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
