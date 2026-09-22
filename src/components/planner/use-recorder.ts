"use client";

import { useCallback, useEffect, useState } from "react";
import type { RecorderStatusDTO } from "@/lib/dto";

/** What `checkTools` calls each piece, in words the Record buttons can show. */
const TOOL_LABELS: Record<string, string> = {
  whisper: "whisper-cli",
  ffmpeg: "ffmpeg",
  recorder: "the recorder helper",
  baseModel: "the live transcript model",
  finalModel: "the final transcript model",
};

export interface RecordingTarget {
  calendarEventId?: number;
  itemId?: number;
  adhoc?: boolean;
}

/** The reason Record is out of reach, or null when it is ready. */
export function recordBlockedReason(status: RecorderStatusDTO): string | null {
  if (status.missing.length > 0) {
    return `Recording needs ${status.missing.map((m) => TOOL_LABELS[m] ?? m).join(", ")}. Run the setup script and reload`;
  }
  if (status.state === "recording" || status.state === "stopping") return "A recording is already running";
  return null;
}

/**
 * What every Record button needs: whether the machine can record at all, whether something is
 * recording now, and one way to start. The dock chip owns the running session; this only
 * starts one and lets the chip know.
 */
export function useRecorder(): {
  status: RecorderStatusDTO;
  blocked: string | null;
  error: string | null;
  record: (target: RecordingTarget) => void;
} {
  const [status, setStatus] = useState<RecorderStatusDTO>({ state: "idle", missing: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/meetings/recorder", { cache: "no-store" });
        if (res.ok && !cancelled) setStatus((await res.json()) as RecorderStatusDTO);
      } catch {
        /* offline: the buttons stay as they were */
      }
    }
    void load();
    const onChanged = () => void load();
    window.addEventListener("sb:recording-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("sb:recording-changed", onChanged);
    };
  }, []);

  const record = useCallback((target: RecordingTarget) => {
    void (async () => {
      try {
        const res = await fetch("/api/meetings/recorder/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(target),
        });
        const body = (await res.json()) as RecorderStatusDTO & { error?: string };
        if (!res.ok) {
          setError(body.error ?? "Could not start recording");
          return;
        }
        setError(null);
        setStatus(body);
      } catch {
        setError("Could not start recording");
      } finally {
        window.dispatchEvent(new Event("sb:recording-changed"));
      }
    })();
  }, []);

  return { status, blocked: recordBlockedReason(status), error, record };
}
