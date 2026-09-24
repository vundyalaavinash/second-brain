import { describe, it, expect } from "vitest";
import { freeSlots, placeSessions, sessionsFor } from "./scheduler";

describe("scheduler", () => {
  it("finds the free slots around meetings and sessions inside the hours", () => {
    const busy = [
      { start: 600, end: 660 }, // 10:00–11:00
      { start: 640, end: 700 }, // overlaps the first
      { start: 900, end: 960 }, // 15:00–16:00
      { start: 480, end: 555 }, // ends 09:15
    ];
    expect(freeSlots(busy, "09:00-18:00", {})).toEqual([
      { start: 555, end: 600 },
      { start: 700, end: 900 },
      { start: 960, end: 1080 },
    ]);
  });
  it("starts no earlier than now, rounded up to five, and drops slivers", () => {
    expect(freeSlots([{ start: 620, end: 700 }], "09:00-18:00", { notBefore: 612 })).toEqual([
      { start: 700, end: 1080 },
    ]);
    expect(freeSlots([{ start: 540, end: 1070 }], "09:00-18:00", {})).toEqual([]);
    expect(freeSlots([{ start: 540, end: 1060 }], "09:00-18:00", {})).toEqual([{ start: 1060, end: 1080 }]);
  });
  it("cuts an estimate into sessions", () => {
    expect(sessionsFor(null, null)).toEqual([25]);
    expect(sessionsFor(50, null)).toEqual([50]);
    expect(sessionsFor(120, null)).toEqual([45, 45, 30]);
    expect(sessionsFor(100, 45)).toEqual([45, 55]);
    expect(sessionsFor(90, 30)).toEqual([30, 30, 30]);
    expect(sessionsFor(20, 45)).toEqual([20]);
  });
  it("lays sessions into slots earliest first, shortening to fit and splitting across slots", () => {
    const slots = [
      { start: 555, end: 600 },
      { start: 700, end: 900 },
    ];
    expect(placeSessions(slots, [45, 45, 30], {})).toEqual({
      placed: [
        { start: 555, end: 600 },
        { start: 700, end: 745 },
        { start: 745, end: 775 },
      ],
      leftover: 0,
    });
    expect(placeSessions([{ start: 700, end: 730 }], [45, 45], {})).toEqual({ placed: [{ start: 700, end: 730 }], leftover: 60 });
    expect(placeSessions([{ start: 700, end: 712 }], [45], {})).toEqual({ placed: [], leftover: 45 });
  });
});
