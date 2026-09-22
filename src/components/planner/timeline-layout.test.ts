import { describe, it, expect } from "vitest";
import { layoutBlocks } from "./timeline-layout";

/** Local wall-clock strings, so the layout is read in the same zone the timeline draws in. */
const at = (id: number, start: string, end: string) => ({ id, startsAt: `2026-09-22T${start}:00`, endsAt: `2026-09-22T${end}:00` });
const RANGE = { dayStart: 7, dayEnd: 21 };

describe("layoutBlocks", () => {
  it("keeps meetings that do not overlap in a single column", () => {
    const blocks = layoutBlocks([at(1, "09:00", "10:00"), at(2, "10:00", "11:00")], RANGE);
    expect(blocks.map((b) => [b.id, b.top, b.height, b.col, b.cols])).toEqual([
      [1, 120, 60, 0, 1],
      [2, 180, 60, 0, 1],
    ]);
  });

  it("splits overlapping meetings across columns", () => {
    const blocks = layoutBlocks([at(1, "09:00", "10:00"), at(2, "09:30", "10:30")], RANGE);
    expect(blocks.map((b) => b.cols)).toEqual([2, 2]);
    expect(new Set(blocks.map((b) => b.col)).size).toBe(2);
  });

  it("clamps a meeting that began before the day to the top", () => {
    const [block] = layoutBlocks([at(1, "06:00", "08:00")], RANGE);
    expect(block.top).toBe(0);
    expect(block.height).toBe(60);
  });

  it("clamps a meeting that runs past the day to the last hour", () => {
    const [block] = layoutBlocks([at(1, "20:00", "23:00")], RANGE);
    expect(block.top).toBe(780);
    expect(block.height).toBe(60);
  });
});
