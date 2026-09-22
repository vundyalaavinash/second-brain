/** The ATX headings of a markdown document, levels 1 to 3, in document order. Fenced code
 * blocks are skipped so a `# comment` inside one never reaches the outline. */
export function headings(md: string): { level: 1 | 2 | 3; text: string }[] {
  const out: { level: 1 | 2 | 3; text: string }[] = [];
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ level: m[1].length as 1 | 2 | 3, text: m[2].replace(/[*_`]/g, "") });
  }
  return out;
}
