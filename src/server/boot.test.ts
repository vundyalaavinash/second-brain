import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { makeTempDataDir } from "@/test/db";
import { getDb } from "@/db/client";
import { backupFilePath } from "@/jobs/handlers/backup";
import type { JobWorker } from "@/jobs/worker";
import { boot, getLastDbCheck, getWorker } from "./boot";

type BootGlobals = {
  __sbWorker?: JobWorker;
  __sbBackupInterval?: NodeJS.Timeout;
  __sbAutoStartInterval?: NodeJS.Timeout;
  __sbFeedInterval?: NodeJS.Timeout;
  __sbDb?: unknown;
};

function g(): BootGlobals {
  return globalThis as unknown as BootGlobals;
}

/** boot() leaves timers and a running worker behind by design -- it is meant to run once for the
 * life of the process. Tests have to undo that between runs, or a later test's assertions would
 * be racing an earlier test's still-ticking worker. `__sbShutdownHooked` is deliberately left
 * alone: it only guards `process.once` signal handlers that are never triggered here. */
function resetBootState(): void {
  g().__sbWorker?.stop();
  if (g().__sbBackupInterval) clearInterval(g().__sbBackupInterval);
  if (g().__sbAutoStartInterval) clearInterval(g().__sbAutoStartInterval);
  if (g().__sbFeedInterval) clearInterval(g().__sbFeedInterval);
  g().__sbWorker = undefined;
  g().__sbBackupInterval = undefined;
  g().__sbAutoStartInterval = undefined;
  g().__sbFeedInterval = undefined;
  const dbGlobal = globalThis as unknown as { __sbDb?: { $client: { close: () => void } } };
  try {
    dbGlobal.__sbDb?.$client.close();
  } catch {
    // already closed
  }
  dbGlobal.__sbDb = undefined;
}

describe("boot", () => {
  let dir: string | undefined;
  afterEach(() => {
    resetBootState();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("does not throw and still starts the worker when the integrity check fails", async () => {
    dir = makeTempDataDir();
    process.env.SB_EMBED = "off";

    // Open and migrate a real database at the path boot()'s own getDb() will use, then give it a
    // real, detectable problem: a foreign key pointing at a row that does not exist. This is the
    // same technique src/db/safety.test.ts uses for checkOpenDatabase's own unhappy path -- a
    // real failure reached through the public API, not a mocked one.
    const db = getDb();
    const now = new Date().toISOString();
    db.$client.pragma("foreign_keys = OFF");
    db.$client
      .prepare("INSERT INTO items (type, title, container_id, created_at, updated_at) VALUES ('note', 'T', 999999, ?, ?)")
      .run(now, now);
    db.$client.pragma("foreign_keys = ON");
    db.$client.close();
    (globalThis as unknown as { __sbDb?: unknown }).__sbDb = undefined; // force boot()'s getDb() to reopen from disk

    // Nothing to back up today, and the feed/auto-start intervals only matter past their delay.
    fs.mkdirSync(path.dirname(backupFilePath()), { recursive: true });
    fs.writeFileSync(backupFilePath(), "stand-in for today's backup, so boot does not enqueue a real one");

    const errorSpy: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errorSpy.push(args.map(String).join(" "));
    };

    let worker: JobWorker | undefined;
    try {
      expect(() => {
        worker = boot();
      }).not.toThrow();
    } finally {
      console.error = originalError;
    }

    expect(worker).toBeDefined();
    expect(getWorker()).toBe(worker);

    const check = getLastDbCheck();
    expect(check?.ok).toBe(false);
    expect(check?.problems.join(" ")).toMatch(/foreign key/i);
    expect(errorSpy.some((line) => /database integrity check/i.test(line))).toBe(true);
  });
});
