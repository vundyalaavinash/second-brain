// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { filterSlashItems, SLASH_ITEMS } from "./slash-menu";

describe("slash menu", () => {
  it("lists every block in order and filters", () => {
    expect(SLASH_ITEMS.map((i) => i.label)).toEqual([
      "Paragraph", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Checklist", "Quote", "Callout", "Code", "Table", "Divider", "Image",
    ]);
    expect(SLASH_ITEMS.map((i) => i.group)).toEqual([
      "Text", "Text", "Text", "Text", "Lists", "Lists", "Lists", "Blocks", "Blocks", "Blocks", "Blocks", "Blocks", "Media",
    ]);
    expect(filterSlashItems("head").map((i) => i.label)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(filterSlashItems("LIST").map((i) => i.label)).toEqual(["Bulleted list", "Numbered list", "Checklist"]);
    expect(filterSlashItems("zzz")).toEqual([]);
  });
});
