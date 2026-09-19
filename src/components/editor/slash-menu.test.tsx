// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { filterSlashItems, SLASH_ITEMS } from "./slash-menu";

describe("slash menu", () => {
  it("lists every block in order and filters", () => {
    expect(SLASH_ITEMS.map((i) => i.label)).toEqual([
      "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Checklist", "Quote", "Code", "Table", "Image", "Callout", "Divider",
    ]);
    expect(filterSlashItems("head").map((i) => i.label)).toEqual(["Heading 1", "Heading 2", "Heading 3"]);
    expect(filterSlashItems("LIST").map((i) => i.label)).toEqual(["Bulleted list", "Numbered list", "Checklist"]);
    expect(filterSlashItems("zzz")).toEqual([]);
  });
});
