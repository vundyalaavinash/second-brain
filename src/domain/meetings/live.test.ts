import { describe, it, expect } from "vitest";
import { mergeTranscript, type LiveSegment } from "./live";

const T1 = "2026-09-22T10:00:00.000Z";
const T2 = "2026-09-22T10:00:05.000Z";

describe("mergeTranscript", () => {
  it("keeps the first window whole", () => {
    expect(mergeTranscript([], "hello there", T1)).toEqual([{ at: T1, text: "hello there" }]);
  });

  it("drops the longest overlap the new window repeats", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there how" }];
    const merged = mergeTranscript(previous, "there how are you", T2);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(previous[0]);
    expect(merged[1]).toEqual({ at: T2, text: "are you" });
  });

  it("adds nothing when the window repeats what is already there", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there how" }];
    expect(mergeTranscript(previous, "hello there how", T2)).toEqual(previous);
  });

  it("adds nothing for an empty or blank window", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello" }];
    expect(mergeTranscript(previous, "", T2)).toEqual(previous);
    expect(mergeTranscript(previous, "   \n ", T2)).toEqual(previous);
    expect(mergeTranscript([], "  ", T1)).toEqual([]);
  });

  it("matches the overlap across segment boundaries and ignores case", () => {
    const previous: LiveSegment[] = [
      { at: T1, text: "hello there" },
      { at: T1, text: "how are" },
    ];
    const merged = mergeTranscript(previous, "How are you today", T2);
    expect(merged).toHaveLength(3);
    expect(merged[2]).toEqual({ at: T2, text: "you today" });
  });

  it("keeps a window that shares nothing with what came before", () => {
    const previous: LiveSegment[] = [{ at: T1, text: "hello there" }];
    const merged = mergeTranscript(previous, "completely different words", T2);
    expect(merged[1]).toEqual({ at: T2, text: "completely different words" });
  });
});
