import os from "node:os";
import path from "node:path";

/** The data directory on this machine when nothing overrides it -- what `dataDir()` falls back
 * to, and the one path a test must never resolve to. Exported as its own function so a test
 * guard can name it exactly rather than reconstructing the same path a second time and risking
 * the two definitions drifting apart. */
export function defaultDataDir(): string {
  return path.join(os.homedir(), "Library", "Application Support", "second-brain");
}

export function dataDir(): string {
  return process.env.SB_DATA_DIR ?? defaultDataDir();
}

export function dbPath(): string {
  return path.join(dataDir(), "brain.db");
}

export function filesDir(): string {
  return path.join(dataDir(), "files");
}

export function attachmentsDir(): string {
  return path.join(dataDir(), "attachments");
}

export function modelsDir(): string {
  return path.join(dataDir(), "models");
}

export function logsDir(): string {
  return path.join(dataDir(), "logs");
}

export function backupsDir(): string {
  return path.join(dataDir(), "backups");
}

export function activityTokenPath(): string {
  return path.join(dataDir(), "activity-token");
}
