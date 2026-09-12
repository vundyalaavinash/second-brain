import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { createTransformersEmbedProvider } from "./transformers";
import { EMBEDDING_DIMENSIONS } from "./types";

const cacheDir = process.env.SB_TEST_MODELS_DIR ?? path.join(os.homedir(), ".cache", "second-brain-test-models");

describe("transformers embed provider", () => {
  it("produces normalized 384-dim vectors deterministically", async () => {
    const p = createTransformersEmbedProvider({ cacheDir });
    const [a, b, c] = await p.embed(["tomatoes need full sun", "tomatoes need full sun", "the stock market fell"]);
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    let norm = 0;
    let same = 0;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      norm += a[i] * a[i];
      same += a[i] * b[i];
      diff += a[i] * c[i];
    }
    expect(norm).toBeCloseTo(1, 3);
    expect(same).toBeCloseTo(1, 3);
    expect(diff).toBeLessThan(0.9);
  }, 180_000);
});
