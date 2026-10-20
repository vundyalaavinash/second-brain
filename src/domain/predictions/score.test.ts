import { describe, expect, it } from "vitest";
import { BRIER_TARGET, brier, calibration, hitRate, meetsTarget } from "./score";

describe("calibration", () => {
  it("is null until something has resolved", () => {
    expect(calibration([])).toEqual({ resolved: 0, inRange: 0, percent: null });
  });

  it("counts the actuals that landed inside the 90% range", () => {
    const c = calibration([
      { p90Low: 2, p90High: 10, actual: 6 },
      { p90Low: 2, p90High: 10, actual: 12 },
      { p90Low: 1, p90High: 4, actual: 3 },
      { p90Low: 1, p90High: 4, actual: 0.5 },
    ]);
    expect(c).toEqual({ resolved: 4, inRange: 2, percent: 50 });
  });

  /** A range you gave includes the number you gave as its edge. */
  it("counts an actual exactly on a bound as inside", () => {
    expect(calibration([{ p90Low: 3, p90High: 9, actual: 3 }]).inRange).toBe(1);
    expect(calibration([{ p90Low: 3, p90High: 9, actual: 9 }]).inRange).toBe(1);
  });

  /** A range typed the wrong way round is still the range the person meant. */
  it("reads a reversed range as the range it describes", () => {
    expect(calibration([{ p90Low: 9, p90High: 3, actual: 5 }]).inRange).toBe(1);
  });

  it("rounds the percentage", () => {
    const rows = [
      { p90Low: 1, p90High: 2, actual: 1.5 },
      { p90Low: 1, p90High: 2, actual: 1.5 },
      { p90Low: 1, p90High: 2, actual: 9 },
    ];
    expect(calibration(rows).percent).toBe(67);
  });
});

describe("brier", () => {
  it("is null until something has resolved", () => {
    expect(brier([])).toEqual({ resolved: 0, score: null });
  });

  /** The canonical calibration check: 50% on everything scores exactly a coin flip. */
  it("scores a 50% answer to everything as a coin flip", () => {
    const rows = [
      { probability: 0.5, outcome: 1 },
      { probability: 0.5, outcome: 0 },
    ];
    expect(brier(rows).score).toBe(0.25);
  });

  it("scores a perfect forecaster at zero", () => {
    const rows = [
      { probability: 1, outcome: 1 },
      { probability: 0, outcome: 0 },
    ];
    expect(brier(rows).score).toBe(0);
  });

  it("scores confident and wrong at one", () => {
    expect(brier([{ probability: 1, outcome: 0 }]).score).toBe(1);
  });

  it("averages across calls", () => {
    const rows = [
      { probability: 0.3, outcome: 0 },
      { probability: 0.8, outcome: 1 },
    ];
    // (0.09 + 0.04) / 2
    expect(brier(rows).score).toBe(0.065);
  });
});

describe("hitRate", () => {
  it("is null until something has resolved", () => {
    expect(hitRate([])).toEqual({ resolved: 0, hit: 0, percent: null });
  });

  it("counts the calls that were right", () => {
    expect(hitRate([{ outcome: 1 }, { outcome: 0 }, { outcome: 1 }, { outcome: 1 }])).toEqual({ resolved: 4, hit: 3, percent: 75 });
  });
});

describe("meetsTarget", () => {
  /** Nothing resolved is not a pass -- a log with no entries must not read as a goal met. */
  it("is false for a score that does not exist yet", () => {
    expect(meetsTarget("estimate", null)).toBe(false);
    expect(meetsTarget("risk", null)).toBe(false);
    expect(meetsTarget("call", null)).toBe(false);
  });

  it("passes calibration at or above the target", () => {
    expect(meetsTarget("estimate", 85)).toBe(true);
    expect(meetsTarget("estimate", 84)).toBe(false);
  });

  /** Brier is the one score where lower wins, so the comparison has to run the other way. */
  it("passes Brier at or below the target", () => {
    expect(meetsTarget("risk", BRIER_TARGET)).toBe(true);
    expect(meetsTarget("risk", 0.19)).toBe(true);
    expect(meetsTarget("risk", 0.21)).toBe(false);
  });

  it("passes a hit rate at or above the target", () => {
    expect(meetsTarget("call", 70)).toBe(true);
    expect(meetsTarget("call", 69)).toBe(false);
  });
});
