import { describe, it, expect } from "vitest";
import { blockEnd, isoToMinutes, minutesToIso, snap } from "./block-math";

describe("block math", () => {
  it("snaps to five minutes and converts both ways", () => {
    expect(snap(632)).toBe(630);
    expect(snap(633)).toBe(635);
    expect(snap(7, 15)).toBe(0);
    expect(minutesToIso("2026-09-23", 635)).toBe("2026-09-23T10:35:00");
    expect(isoToMinutes("2026-09-23T10:35:00")).toBe(635);
  });
  it("ends a block its estimate later, or 25 minutes later", () => {
    expect(blockEnd({ scheduledAt: "2026-09-23T10:35:00", estimateMinutes: 50 })).toBe("2026-09-23T11:25:00");
    expect(blockEnd({ scheduledAt: "2026-09-23T23:50:00", estimateMinutes: null })).toBe("2026-09-24T00:15:00");
  });
});
