import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type DB } from "@/db/client";

export interface TestDb {
  db: DB;
  dir: string;
  cleanup: () => void;
}

/** Point SB_DATA_DIR at a fresh temp directory and clear the singleton database. */
export function makeTempDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sb-test-"));
  process.env.SB_DATA_DIR = dir;
  const g = globalThis as unknown as { __sbDb?: unknown };
  delete g.__sbDb;
  return dir;
}

export function makeTestDb(): TestDb {
  const dir = makeTempDataDir();
  const db = openDatabase(path.join(dir, "test.db"));
  return {
    db,
    dir,
    cleanup: () => {
      db.$client.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
