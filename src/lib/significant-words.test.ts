import { describe, it, expect } from "vitest";
import { significantWords, shareWord, MIN_SIGNIFICANT_WORD_LENGTH } from "./significant-words";

describe("significantWords", () => {
  it("lowercases and keeps only words at or above the shared threshold", () => {
    expect(significantWords("The Q3 Platform Migration")).toEqual(new Set(["platform", "migration"]));
  });

  it("drops words shorter than the threshold, even several of them", () => {
    expect(MIN_SIGNIFICANT_WORD_LENGTH).toBe(4);
    expect(significantWords("Fix the bug for Tim")).toEqual(new Set([]));
  });
});

describe("shareWord", () => {
  it("is true when the two sets share at least one word", () => {
    expect(shareWord(new Set(["platform", "sync"]), new Set(["weekly", "platform"]))).toBe(true);
  });

  it("is false when nothing overlaps, including two empty sets", () => {
    expect(shareWord(new Set(["platform"]), new Set(["weekly"]))).toBe(false);
    expect(shareWord(new Set(), new Set())).toBe(false);
  });
});
