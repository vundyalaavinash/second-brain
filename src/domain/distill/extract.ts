export const MIN_QUOTES = 2;
export const MAX_QUOTES = 5;
export const MIN_WORDS = 40;

/** A word short enough to be noise for scoring purposes -- "the", "and", "was". Mirrors the
 * threshold `significant-words.ts` uses for a different job (matching two short strings); this
 * one scores sentences within a much longer document, so it stays a private constant here rather
 * than importing that module's, which would couple two unrelated matching jobs together. */
const STOPWORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "has", "had", "was", "were",
  "are", "will", "would", "could", "should", "about", "into", "than", "then", "them", "they",
  "their", "there", "here", "when", "what", "which", "while", "been", "being", "just", "also",
  "not", "but", "you", "your", "our", "its", "his", "her", "she", "him",
]);

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function words(sentence: string): string[] {
  return (sentence.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => !STOPWORDS.has(w) && w.length > 2);
}

/**
 * Scores each sentence by the summed rarity of its own words across the whole text (a word that
 * appears in every sentence carries no signal; one that appears once is exactly what the sentence
 * is "about"), then returns the top-scoring sentences in their original reading order. Purely a
 * function of the text: no model, so nothing here can ever propose a sentence that was not
 * genuinely written by whoever wrote the source.
 */
export function suggestQuotes(text: string, opts: { max?: number } = {}): string[] {
  const max = opts.max ?? MAX_QUOTES;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const sentenceWords = sentences.map(words);
  const documentFrequency = new Map<string, number>();
  for (const ws of sentenceWords) {
    for (const w of new Set(ws)) documentFrequency.set(w, (documentFrequency.get(w) ?? 0) + 1);
  }

  const scores = sentenceWords.map((ws) => {
    if (ws.length === 0) return 0;
    const total = ws.reduce((sum, w) => sum + 1 / (documentFrequency.get(w) ?? 1), 0);
    return total / ws.length;
  });

  const ranked = sentences
    .map((sentence, i) => ({ sentence, index: i, score: scores[i] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, max);

  return ranked.sort((a, b) => a.index - b.index).map((r) => r.sentence);
}

/** Only a suggested quote that is a genuine, exact substring of the source survives -- a
 * paraphrase, a whitespace difference, or a fabrication is dropped, never shown as if it were
 * evidence. Order of the surviving quotes matches the order they were given. */
export function verifyQuotes(sourceText: string, quotes: string[]): string[] {
  return quotes.filter((q) => sourceText.includes(q));
}
