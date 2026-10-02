import { describe, expect, it } from "vitest";
import { chunkTranscript } from "./chunk";

const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/** Sentences of a known, uniform length, so a budget can be reasoned about exactly. */
function sentences(n: number): string {
  return Array.from({ length: n }, (_, i) => `Sentence number ${i} said something worth recording.`).join(" ");
}

describe("chunkTranscript", () => {
  it("leaves a transcript that already fits as one piece, untouched", () => {
    const text = sentences(3);
    expect(chunkTranscript(text, { budget: 10_000 })).toEqual([text]);
  });

  it("is empty for an empty transcript, rather than one empty chunk", () => {
    expect(chunkTranscript("", { budget: 100 })).toEqual([]);
    expect(chunkTranscript("   \n  ", { budget: 100 })).toEqual([]);
  });

  it("keeps every chunk inside the budget", () => {
    const chunks = chunkTranscript(sentences(60), { budget: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(400);
  });

  it("never cuts a sentence in half", () => {
    for (const chunk of chunkTranscript(sentences(60), { budget: 400 })) {
      expect(chunk.trim()).toMatch(/[.!?]$/);
    }
  });

  /** The whole reason this exists: a split that drops a sentence is a summary with a hole in it,
   *  and nothing downstream could tell. */
  it("loses nothing -- every sentence survives in some chunk", () => {
    const chunks = chunkTranscript(sentences(60), { budget: 400 });
    const joined = chunks.join(" ");
    for (let i = 0; i < 60; i++) {
      expect(joined).toContain(`Sentence number ${i} said`);
    }
  });

  // A decision stated across a boundary -- "so we'll go with Tuesday." / "Right, Priya owns it."
  // -- is invisible to both neighbours without this.
  it("repeats the tail of each chunk at the head of the next", () => {
    const chunks = chunkTranscript(sentences(40), { budget: 500, overlapSentences: 2 });
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const previousTail = chunks[i - 1].split(SENTENCE_BOUNDARY).slice(-2).join(" ");
      expect(chunks[i].startsWith(previousTail)).toBe(true);
    }
  });

  it("can be told not to overlap at all", () => {
    const chunks = chunkTranscript(sentences(40), { budget: 500, overlapSentences: 0 });
    const total = chunks.join(" ").length;
    // Without overlap the pieces are the original plus only the joins between them.
    expect(total).toBeLessThanOrEqual(sentences(40).length + chunks.length);
  });

  // Whisper occasionally produces a wall of text with no terminator at all. Hard-splitting it is
  // ugly, but a chunk over the budget is refused outright and the meeting gets no summary.
  it("hard-splits a single sentence too long to fit", () => {
    const monster = `${"word ".repeat(400)}.`;
    const chunks = chunkTranscript(monster, { budget: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(200);
    expect(chunks.join("").replace(/\s+/g, "")).toBe(monster.replace(/\s+/g, ""));
  });

  it("still terminates when the overlap would not leave room for new text", () => {
    const chunks = chunkTranscript(sentences(30), { budget: 120, overlapSentences: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThan(100);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(120);
  });
});
