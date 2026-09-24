import { describe, it, expect } from "vitest";
import { blockEnd, blocksOn, firstBlock, isoToMinutes, minutesToIso, snap } from "./block-math";

describe("block math", () => {
  it("snaps to five minutes and converts both ways", () => {
    expect(snap(632)).toBe(630);
    expect(snap(633)).toBe(635);
    expect(snap(7, 15)).toBe(0);
    expect(minutesToIso("2026-09-23", 635)).toBe("2026-09-23T10:35:00");
    expect(isoToMinutes("2026-09-23T10:35:00")).toBe(635);
  });
  it("ends a session its own length later, rolling past midnight", () => {
    expect(blockEnd({ startsAt: "2026-09-23T10:35:00", minutes: 50 })).toBe("2026-09-23T11:25:00");
    expect(blockEnd({ startsAt: "2026-09-23T23:50:00", minutes: 25 })).toBe("2026-09-24T00:15:00");
  });
  it("takes the day's own sessions, in start order, and names the first", () => {
    const task = {
      blocks: [
        { startsAt: "2026-09-23T10:30:00" },
        { startsAt: "2026-09-23T14:00:00" },
        { startsAt: "2026-09-24T09:00:00" },
      ],
    };
    expect(blocksOn(task, "2026-09-23").map((b) => b.startsAt)).toEqual(["2026-09-23T10:30:00", "2026-09-23T14:00:00"]);
    expect(firstBlock(task, "2026-09-23")?.startsAt).toBe("2026-09-23T10:30:00");
    expect(firstBlock(task, "2026-09-25")).toBeUndefined();
  });
});
