export function deriveTitle(body: string): string {
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "Untitled note";
  return line.replace(/^#+\s*/, "").slice(0, 80);
}

export function isProbablyUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
