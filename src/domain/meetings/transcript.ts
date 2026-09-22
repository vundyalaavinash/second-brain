/** One line of a transcript, in seconds from the start of the recording. */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

interface WhisperRow {
  offsets?: { from?: unknown; to?: unknown };
  text?: unknown;
}

/**
 * Parse the JSON `whisper-cli -oj` writes: `transcription[]` with millisecond
 * offsets and a leading space on every line. Segments that hold only whitespace
 * (whisper emits them for silence) are dropped.
 */
export function parseWhisperJson(json: string): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`whisper output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rows = (parsed as { transcription?: unknown } | null)?.transcription;
  if (!Array.isArray(rows)) throw new Error("whisper output has no transcription array");

  const segments: Segment[] = [];
  rows.forEach((row: WhisperRow, i) => {
    const from = row?.offsets?.from;
    const to = row?.offsets?.to;
    if (typeof from !== "number" || typeof to !== "number") {
      throw new Error(`whisper segment ${i} has no numeric offsets`);
    }
    const text = typeof row.text === "string" ? row.text.trim() : "";
    if (!text) return;
    segments.push({ start: from / 1000, end: to / 1000, text });
  });
  return segments;
}

/** Join segments into one paragraph of plain text. */
export function segmentsToText(segments: Segment[]): string {
  return segments.map((s) => s.text).join(" ").trim();
}
