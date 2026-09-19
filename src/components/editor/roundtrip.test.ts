// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "./extensions";
import { prepareMarkdown } from "./rich-editor";

const dir = path.join(__dirname, "fixtures");
const normalise = (s: string) => s.replace(/[ \t]+$/gm, "").replace(/\n+$/, "") + "\n";

function roundTrip(md: string): string {
  const el = document.createElement("div");
  const editor = new Editor({ element: el, extensions: buildExtensions({}), content: prepareMarkdown(md), contentType: "markdown" });
  const out = editor.getMarkdown();
  editor.destroy();
  return out;
}

describe("markdown round-trip", () => {
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "html.md")) {
    it(`preserves ${name}`, () => {
      const input = fs.readFileSync(path.join(dir, name), "utf8");
      expect(normalise(roundTrip(input))).toBe(normalise(input));
    });
  }

  it("is idempotent", () => {
    const input = fs.readFileSync(path.join(dir, "blocks.md"), "utf8");
    const once = roundTrip(input);
    expect(roundTrip(once)).toBe(once);
  });

  it("keeps raw html as a fenced block", () => {
    const input = fs.readFileSync(path.join(dir, "html.md"), "utf8");
    const out = roundTrip(input);
    expect(out).toContain("```html\n<div class=\"x\">raw</div>\n```");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
  });

  it("wraps a raw html block that follows an earlier fenced code block", () => {
    const input = 'Before.\n\n```ts\nconst x = 1;\n```\n\n<div class="x">raw</div>\n\nAfter.\n';
    expect(prepareMarkdown(input)).toBe(
      'Before.\n\n```ts\nconst x = 1;\n```\n\n```html\n<div class="x">raw</div>\n```\n\nAfter.\n',
    );
    const out = roundTrip(input);
    expect(out).toContain('```html\n<div class="x">raw</div>\n```');
    expect(out).toContain("```ts\nconst x = 1;\n```");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
  });

  it("does not double-wrap a div line that is already inside a fence", () => {
    const input = "```ts\n<div>fake</div>\n```\n";
    expect(prepareMarkdown(input)).toBe(input);
    const out = roundTrip(input);
    expect(out).not.toContain("```html");
    expect(out).toContain("```ts\n<div>fake</div>\n```");
  });
});
