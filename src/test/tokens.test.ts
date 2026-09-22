import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const OLD = [/\bbg-bg\b/, /\bbg-surface-[123]\b/, /\bborder-line\b/, /\bborder-line-strong\b/, /\bdivide-line\b/, /\btext-accent\b/, /\bbg-accent\b/, /\bbg-accent-dim\b/, /\bborder-accent\b/, /\baccent-accent\b/, /\btext-bg\b/, /\bfrost\b/, /--font-geist-sans/, /#4cc9ff/i, /\bbg-ink\b/, /\bbg-slate(-2)?\b/, /\bhover:bg-slate(-2)?\b/, /\b(text|bg|border|accent)-brass(-dim|-ink)?\b/, /\b(bg|text|border)-paper(-2|-rule|-fg|-muted|-link)?\b/, /\bon-paper\b/, /\bshadow-(dock|paper)\b/, /\btone=/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("design tokens", () => {
  it("no file uses the retired token classes", () => {
    const hits: string[] = [];
    for (const file of walk(path.join(process.cwd(), "src"))) {
      const text = fs.readFileSync(file, "utf8");
      for (const re of OLD) if (re.test(text)) hits.push(`${path.relative(process.cwd(), file)}: ${re}`);
    }
    expect(hits).toEqual([]);
  });
});
