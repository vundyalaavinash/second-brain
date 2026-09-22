import { describe, it, expect } from "vitest";
import { headings } from "./headings";
describe("headings", () => {
  it("collects levels 1 to 3 and skips code fences", () => {
    const md = "# Title\n\ntext\n\n## Part one\n\n```\n# not a heading\n```\n\n### Detail\n\n#### too deep\n";
    expect(headings(md)).toEqual([{ level: 1, text: "Title" }, { level: 2, text: "Part one" }, { level: 3, text: "Detail" }]);
  });
});
