import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { items } from "@/db/schema";
import { parseMeta, updateItem } from "@/domain/items";
import { filesDir } from "@/lib/paths";
import { finishRecordingItem, queueFinalTranscript, type RecordingMeta } from "./recorder";
import { recorderStatus, stopRecording } from "./index";

/** A WAV with nothing but its 44-byte header holds no audio: that is a session that recorded nothing. */
const WAV_HEADER_BYTES = 44;

/** How long the shutdown handler waits for the helper to patch its header before giving up. */
export const SHUTDOWN_STOP_MS = 3000;

export interface ReconcileResult {
  done: number;
  failed: number;
}

/** The session the controller is running right now, which is live rather than stranded. */
function liveItemId(): number | undefined {
  const status = recorderStatus();
  return status.state === "recording" || status.state === "stopping" ? status.itemId : undefined;
}

/**
 * Closes recordings the last process left open. A restart kills `sb-recorder` without ever
 * running `Recorder.onExit`, so the item sits at `meta.recording.state === "recording"` for
 * good: the page shows "Recording", hides Record, and polls a controller that knows nothing
 * about it. The WAV decides which way each one goes, on the same rule the live path follows —
 * whatever was recorded is kept and gets its final pass, and a session that recorded nothing
 * is an error the person can see and dismiss.
 */
export function reconcileRecordings(db: DB, log?: (message: string) => void): ReconcileResult {
  const live = liveItemId();
  const base = filesDir();
  const result: ReconcileResult = { done: 0, failed: 0 };
  const stranded = db
    .select()
    .from(items)
    .where(and(eq(items.type, "meeting"), sql`json_extract(${items.meta}, '$.recording.state') = 'recording'`))
    .all();

  for (const item of stranded) {
    if (item.id === live) continue;
    const recording = parseMeta<{ recording?: RecordingMeta }>(item).recording;
    if (!recording) continue;
    const wav = path.join(base, recording.wavPath);
    let bytes = 0;
    try {
      bytes = fs.statSync(wav).size;
    } catch {
      bytes = 0;
    }
    if (bytes > WAV_HEADER_BYTES) {
      finishRecordingItem(db, item.id, "done");
      queueFinalTranscript(db, item.id);
      result.done += 1;
      log?.(`"${item.title}" was still recording at shutdown: keeping ${bytes} bytes and queuing the transcript`);
    } else {
      finishRecordingItem(db, item.id, "error");
      // The item is only "processing" because the recording put it there; nothing will finish it now.
      if (item.status === "processing") updateItem(db, item.id, { status: "ready" });
      result.failed += 1;
      log?.(`"${item.title}" was still recording at shutdown with nothing on disk: marked failed`);
    }
  }
  return result;
}

/**
 * The shutdown half of the same problem: stop the helper while the process can still ask it
 * to, so it flushes its WAV header and `reconcileRecordings` finds a playable file next boot.
 * Bounded, because a shutdown that hangs on the recorder is worse than a truncated WAV.
 */
export async function stopForShutdown(
  deps: { stop?: () => Promise<unknown>; timeoutMs?: number; log?: (message: string) => void } = {},
): Promise<void> {
  const stop = deps.stop ?? stopRecording;
  const timeoutMs = deps.timeoutMs ?? SHUTDOWN_STOP_MS;
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    timer.unref?.();
  });
  try {
    const outcome = await Promise.race([stop().then(() => "stopped" as const), expired]);
    if (outcome === "timeout") deps.log?.(`the recorder did not stop within ${timeoutMs}ms; shutting down anyway`);
  } catch (err) {
    deps.log?.(`could not stop the recorder: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
