import { describe, it, expect } from "vitest";
import { parseWhisperJson, segmentsToText } from "./transcript";

const sample = JSON.stringify({
  transcription: [
    { timestamps: { from: "00:00:00,000", to: "00:00:02,500" }, offsets: { from: 0, to: 2500 }, text: " Hello there." },
    { timestamps: { from: "00:00:02,500", to: "00:00:05,000" }, offsets: { from: 2500, to: 5000 }, text: " Second line." },
  ],
});

describe("parseWhisperJson", () => {
  it("maps offsets to seconds and trims text", () => {
    expect(parseWhisperJson(sample)).toEqual([
      { start: 0, end: 2.5, text: "Hello there." },
      { start: 2.5, end: 5, text: "Second line." },
    ]);
  });

  it("joins segments into plain text", () => {
    expect(segmentsToText(parseWhisperJson(sample))).toBe("Hello there. Second line.");
  });

  it("drops segments whose text is only whitespace", () => {
    const json = JSON.stringify({
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: "  " },
        { offsets: { from: 1000, to: 2000 }, text: " Kept." },
      ],
    });
    expect(parseWhisperJson(json)).toEqual([{ start: 1, end: 2, text: "Kept." }]);
  });

  it("throws a readable error on malformed input", () => {
    expect(() => parseWhisperJson("{}")).toThrow(/transcription/);
  });

  it("throws a readable error when the text is not JSON", () => {
    expect(() => parseWhisperJson("not json")).toThrow(/whisper/i);
  });

  it("throws when a segment has no offsets", () => {
    expect(() => parseWhisperJson(JSON.stringify({ transcription: [{ text: "hi" }] }))).toThrow(/offsets/);
  });

  it("returns an empty list for an empty transcription", () => {
    expect(parseWhisperJson(JSON.stringify({ transcription: [] }))).toEqual([]);
    expect(segmentsToText([])).toBe("");
  });
});
