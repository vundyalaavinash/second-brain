import { describe, it, expect } from "vitest";
import { magnifyScale } from "./use-magnify";

describe("magnifyScale", () => {
  it("peaks under the cursor", () => {
    expect(magnifyScale(0, 1.35, 96)).toBe(1.35);
  });

  it("is back to rest at the radius and beyond", () => {
    expect(magnifyScale(96, 1.35, 96)).toBe(1);
    expect(magnifyScale(200, 1.35, 96)).toBe(1);
  });

  it("falls off linearly between the two", () => {
    expect(magnifyScale(48, 1.35, 96)).toBeCloseTo(1.175, 10);
  });

  it("treats the two sides alike", () => {
    expect(magnifyScale(-48, 1.35, 96)).toBe(magnifyScale(48, 1.35, 96));
    expect(magnifyScale(-96, 1.35, 96)).toBe(1);
  });
});
