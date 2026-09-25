import { describe, it, expect } from "vitest";
import { driftFactor, forecastMinutes, DRIFT_MIN_PAIRS, DRIFT_WINDOW, DRIFT_FLOOR, DRIFT_CEILING } from "./drift";

const pairs = (ratios: number[]) => ratios.map((r) => ({ estimateMinutes: 60, actualMinutes: 60 * r }));

describe("driftFactor", () => {
  it("has no answer below the minimum, rather than a made-up one", () => {
    expect(driftFactor(pairs(Array(DRIFT_MIN_PAIRS - 1).fill(2)))).toBeNull();
    expect(driftFactor([])).toBeNull();
  });

  it("answers at exactly the minimum", () => {
    expect(driftFactor(pairs(Array(DRIFT_MIN_PAIRS).fill(2)))).toBe(2);
  });

  it("takes the median, so one runaway task does not move it", () => {
    // Eight tasks that ran roughly on time and one that ran six times over.
    const ratios = [1, 1, 1.1, 1.2, 1, 1.1, 1, 1.2, 6];
    expect(driftFactor(pairs(ratios))).toBeCloseTo(1.1, 5);
  });

  it("reads only the most recent window", () => {
    // Older entries come last: the newest DRIFT_WINDOW are all 2, the tail is all 1.
    const recent = pairs(Array(DRIFT_WINDOW).fill(2));
    const old = pairs(Array(20).fill(1));
    expect(driftFactor([...recent, ...old])).toBe(2);
  });

  it("clamps a figure that is a bug in the data rather than a fact about the person", () => {
    expect(driftFactor(pairs(Array(10).fill(99)))).toBe(DRIFT_CEILING);
    expect(driftFactor(pairs(Array(10).fill(0.01)))).toBe(DRIFT_FLOOR);
  });

  it("ignores a pair with a zero or absent estimate rather than dividing by it", () => {
    const withZero = [...pairs(Array(DRIFT_MIN_PAIRS).fill(2)), { estimateMinutes: 0, actualMinutes: 30 }];
    expect(driftFactor(withZero)).toBe(2);
  });
});

describe("forecastMinutes", () => {
  it("is null without a drift figure, so nothing downstream invents one", () => {
    expect(forecastMinutes(120, null)).toBeNull();
  });
  it("multiplies and rounds to the minute", () => {
    expect(forecastMinutes(120, 1.5)).toBe(180);
    expect(forecastMinutes(50, 1.33)).toBe(67);
  });
});
