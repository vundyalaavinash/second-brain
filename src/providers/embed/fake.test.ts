import { describe, it, expect } from "vitest";
import { createFakeEmbedProvider } from "./fake";
import { EMBEDDING_DIMENSIONS } from "./types";

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

describe("fake embed provider", () => {
  it("returns unit vectors of the right size, deterministically", async () => {
    const p = createFakeEmbedProvider();
    const [a, b] = await p.embed(["hello world", "hello world"]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(cosine(a, a)).toBeCloseTo(1, 5);
    expect(await p.embed([])).toEqual([]);
  });

  it("places overlapping texts closer than unrelated ones", async () => {
    const p = createFakeEmbedProvider();
    const [a, b, c] = await p.embed(["tomato garden sun", "garden tomato water", "quarterly revenue report"]);
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
  });
});
