/** The part of a meeting the timeline needs to place it. */
export interface TimelineMeeting {
  id: number;
  startsAt: string;
  endsAt: string;
}

/** One placed block: `top` and `height` in minutes from `dayStart`, `col` of `cols` across. */
export interface TimelineBlock {
  id: number;
  top: number;
  height: number;
  col: number;
  cols: number;
}

/** A block never collapses to a hairline, however short or clipped the meeting is. */
const MIN_HEIGHT = 20;

function minutesOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
}

/** Where a meeting ends, counted from its own start, so one running past midnight lands past
 * the end of the column and is clipped there rather than wrapping back to a stub at the top. */
function endMinutes(m: TimelineMeeting): number {
  return minutesOfDay(m.startsAt) + (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000;
}

/**
 * Places meetings on the day's column. Meetings that overlap in time share the width: each
 * takes the first column free at its start, and everything in the same run of overlaps is
 * told how many columns that run needed, so the blocks in it come out the same width.
 * Anything reaching outside `[dayStart, dayEnd)` is clipped to it rather than dropped.
 */
export function layoutBlocks(meetings: TimelineMeeting[], { dayStart, dayEnd }: { dayStart: number; dayEnd: number }): TimelineBlock[] {
  const startMin = dayStart * 60;
  const endMin = dayEnd * 60;
  const spans = meetings
    .map((m) => {
      const from = Math.max(startMin, Math.min(endMin, minutesOfDay(m.startsAt)));
      const to = Math.max(from, Math.min(endMin, endMinutes(m)));
      return { id: m.id, from, to };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to || a.id - b.id);

  const blocks: TimelineBlock[] = [];
  // One run of mutually reachable overlaps at a time: `columnEnds` holds when each column
  // frees up, and the run closes as soon as a meeting starts after every column is free.
  let columnEnds: number[] = [];
  let runStart = 0;
  function closeRun(cols: number) {
    for (let i = runStart; i < blocks.length; i++) blocks[i].cols = cols;
    runStart = blocks.length;
    columnEnds = [];
  }
  for (const span of spans) {
    if (columnEnds.length > 0 && columnEnds.every((end) => end <= span.from)) closeRun(columnEnds.length);
    let col = columnEnds.findIndex((end) => end <= span.from);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = span.to;
    blocks.push({ id: span.id, top: span.from - startMin, height: Math.max(MIN_HEIGHT, span.to - span.from), col, cols: 1 });
  }
  closeRun(columnEnds.length);
  return blocks;
}
