import { describe, it, expect } from "vitest";
import { chunkText, DEFAULT_CHUNK_OPTIONS } from "./chunk";

const words = (n: number, prefix = "w") => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");

describe("chunkText", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("  \n\n  ")).toEqual([]);
  });

  it("normalizes whitespace inside a short paragraph", () => {
    expect(chunkText("hello   world\n  again")).toEqual(["hello world again"]);
  });

  it("packs small paragraphs into one chunk", () => {
    expect(chunkText("one two\n\nthree four")).toEqual(["one two three four"]);
  });

  it("splits a long paragraph into overlapping windows", () => {
    const text = words(1000);
    const out = chunkText(text);
    expect(out).toHaveLength(3);
    const first = out[0].split(" ");
    const second = out[1].split(" ");
    expect(first).toHaveLength(375);
    expect(second.slice(0, 40)).toEqual(first.slice(335));
    expect(second[40]).toBe("w375");
    for (const c of out) {
      expect(c.split(" ").length).toBeLessThanOrEqual(DEFAULT_CHUNK_OPTIONS.maxWords + DEFAULT_CHUNK_OPTIONS.overlapWords);
    }
  });

  it("starts a new chunk when the next paragraph does not fit", () => {
    const text = `${words(300, "a")}\n\n${words(300, "b")}`;
    const out = chunkText(text);
    expect(out).toHaveLength(2);
    expect(out[0].split(" ")).toHaveLength(300);
    expect(out[1].split(" ").slice(40)[0]).toBe("b0");
  });

  it("honours custom options", () => {
    const out = chunkText(words(10), { maxWords: 4, overlapWords: 1 });
    expect(out).toEqual(["w0 w1 w2 w3", "w3 w4 w5 w6 w7", "w7 w8 w9"]);
  });
});
