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

export interface RecordAffordance {
  /** Why the button is out of reach, or null when it can be pressed. */
  blocked: string | null;
  /** What the button says for itself, blocked or not. */
  title: string | null;
}

function label(key: string): string {
  return TOOL_LABELS[key] ?? key;
}

/**
 * What the Record buttons should look like right now.
 *
 * Only the recorder helper is the difference between recording and not: without whisper or a
 * model the meeting is still captured to disk, and the transcript catches up once the tools
 * are installed. So a missing transcription tool is a note on a live button, not a locked one.
 */
export function recordAffordance(status: RecorderStatusDTO, loaded: boolean): RecordAffordance {
  /** A reason that both stops the button and explains it. */
  const stop = (reason: string): RecordAffordance => ({ blocked: reason, title: reason });

  if (!loaded) return stop("Checking the recorder");
  if (status.missing.includes("recorder")) return stop("Recording needs the recorder helper. Run the setup script and reload");
  if (status.state === "recording" || status.state === "stopping") return stop("A recording is already running");
  if (status.missing.length > 0) return { blocked: null, title: `Transcription needs: ${status.missing.map(label).join(", ")}` };
  return { blocked: null, title: null };
}

/**
 * What every Record button needs: whether the machine can record at all, whether something is
 * recording now, and one way to start. The dock chip owns the running session; this only
 * starts one and lets the chip know.
 */
export function useRecorder(): {
  status: RecorderStatusDTO;
  loaded: boolean;
  blocked: string | null;
  title: string | null;
  error: string | null;
  record: (target: RecordingTarget) => void;
} {
  const [status, setStatus] = useState<RecorderStatusDTO>({ state: "idle", missing: [] });
  // Until the first answer lands, the buttons say so rather than promising a recording.
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/meetings/recorder", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const next = (await res.json()) as RecorderStatusDTO;
        if (cancelled) return;
        setStatus(next);
        setLoaded(true);
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

  const { blocked, title } = recordAffordance(status, loaded);
  return { status, loaded, blocked, title, error, record };
}
