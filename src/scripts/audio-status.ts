/**
 * Prints design §9.4's audio footprint -- how many meeting recordings are held, how much space
 * they take, and when the next one is due for release -- and does nothing else. This is
 * `scripts/brain.sh audio-status`.
 *
 * Read-only, and deliberately opens the database the same careful way `verify-backups.ts` does:
 * a plain `readonly` connection, wrapped in just enough drizzle to run `audioFootprint`'s
 * queries, never through `openDatabase()`. `take-backup.ts`'s own doc comment explains why a
 * standalone script must not be the thing that silently applies a pending migration just to
 * answer a status question -- the same reasoning applies here.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/db/schema";
import { dbPath } from "@/lib/paths";
import { audioFootprint } from "@/domain/meetings/audio-retention";
import { formatUtcDay } from "@/components/activity/format";

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function main(): void {
  const file = dbPath();
  if (!fs.existsSync(file)) {
    console.error(`no database at ${file}`);
    process.exitCode = 1;
    return;
  }

  const sqlite = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const db = drizzle(sqlite, { schema });
    const { recordings, bytes, nextReleaseAt } = audioFootprint(db);
    if (recordings === 0) {
      console.log("no audio held");
      return;
    }
    console.log(`${recordings} recording(s) held, ${mb(bytes)} MB`);
    console.log(nextReleaseAt ? `next release due ${formatUtcDay(nextReleaseAt)} (${nextReleaseAt})` : "nothing currently due for release");
  } finally {
    sqlite.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
