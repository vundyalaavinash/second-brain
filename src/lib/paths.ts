import os from "node:os";
import path from "node:path";

export function dataDir(): string {
  return process.env.SB_DATA_DIR ?? path.join(os.homedir(), "Library", "Application Support", "second-brain");
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

export function activityTokenPath(): string {
  return path.join(dataDir(), "activity-token");
}
