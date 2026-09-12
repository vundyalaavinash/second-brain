import { describe, it, expect } from "vitest";
import { reciprocalRankFusion } from "./fuse";

describe("reciprocalRankFusion", () => {
  it("ranks items present in both lists above items in one", () => {
    const a = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const b = [{ id: 3 }, { id: 4 }];
    const fused = reciprocalRankFusion([a, b], (x) => x.id);
    expect(fused.map((f) => f.key)).toEqual([3, 1, 2, 4]);
    expect(fused[0].score).toBeCloseTo(1 / 63 + 1 / 61, 6);
  });

  it("keeps the first occurrence as the carried item and handles empty lists", () => {
    const fused = reciprocalRankFusion([[], [{ id: 9, tag: "b" }]], (x) => x.id);
    expect(fused).toEqual([{ key: 9, score: 1 / 61, item: { id: 9, tag: "b" } }]);
    expect(reciprocalRankFusion([[], []], (x: { id: number }) => x.id)).toEqual([]);
  });

  it("uses the k parameter", () => {
    const fused = reciprocalRankFusion([[{ id: 1 }]], (x) => x.id, 0);
    expect(fused[0].score).toBe(1);
  });
});
