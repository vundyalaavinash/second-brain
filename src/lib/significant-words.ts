/**
 * A word shorter than this is too common to mean two things are related — matching on "the" or
 * "for" would turn nearly every pair into a "match". Shared by every dull-matching feature in
 * this codebase (the forecast slice's `likeThisMinutesByTask`, `@/domain/focus`; the
 * meeting-to-container suggestion, `@/domain/containers/suggest`) so the threshold can only
 * drift by an explicit, shared decision, never by one side being edited alone (review F4).
 */
export const MIN_SIGNIFICANT_WORD_LENGTH = 4;

/**
 * A title or name's words, lowercased and long enough to matter, deduplicated — the set two
 * strings are compared through for a "shares a real word" match.
 */
export function significantWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= MIN_SIGNIFICANT_WORD_LENGTH));
}

/** Whether two word sets share at least one word. */
export function shareWord(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}
