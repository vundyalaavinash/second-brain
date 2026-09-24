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
  it("ends a session its own length later, rolling past midnight", () => {
    expect(blockEnd({ startsAt: "2026-09-23T10:35:00", minutes: 50 })).toBe("2026-09-23T11:25:00");
    expect(blockEnd({ startsAt: "2026-09-23T23:50:00", minutes: 25 })).toBe("2026-09-24T00:15:00");
  });
});
