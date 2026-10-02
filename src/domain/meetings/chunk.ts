/**
 * Splitting a transcript into pieces a local model will accept.
 *
 * The budget is in characters, not tokens, because there is no tokeniser in this process -- and
 * deliberately so: `llama-cli` reports the exact token count of a prompt it refuses, so the caller
 * can derive characters-per-token for the transcript in front of it rather than assume a constant.
 * Measured on a real transcript here it is 4.12; on repetitive text it is 5.0. A guessed constant
 * is wrong by enough to matter, and wrong in the direction that loses text.
 */
export interface ChunkOptions {
  /** The most characters any one chunk may contain. */
  budget: number;
  /** Sentences repeated from the end of each chunk at the start of the next. Default 2. */
  overlapSentences?: number;
}

/** Sentence terminator followed by whitespace -- good enough for speech, which is what this sees. */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/** Split text that has no sentence boundary to split on into budget-sized pieces. */
function hardSplit(text: string, budget: number): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += budget) pieces.push(text.slice(i, i + budget));
  return pieces;
}

/**
 * The transcript in order, as pieces that each fit `budget`, with the tail of each repeated at the
 * head of the next so a decision stated across a boundary is visible to at least one piece whole.
 *
 * Every sentence appears in at least one chunk. That is the property worth protecting: duplication
 * is something the merge step can collapse, whereas a dropped sentence is a hole in the summary
 * that nothing downstream can detect.
 */
export function chunkTranscript(text: string, options: ChunkOptions): string[] {
  const { budget } = options;
  const overlapSentences = options.overlapSentences ?? 2;
  const trimmed = text.trim();

  if (!trimmed) return [];
  if (trimmed.length <= budget) return [trimmed];

  // A sentence longer than the budget can never be packed, so it is broken up first and its
  // pieces treated as sentences from here on.
  const units = trimmed
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s.length > budget ? hardSplit(s, budget) : [s]));

  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;

  const close = () => {
    if (current.length === 0) return;
    chunks.push(current.join(" "));
    // Seed the next chunk with this one's tail. Dropped entirely when it would not leave room for
    // new text -- without that guard a large overlap against a small budget makes no progress and
    // loops forever.
    const seed = overlapSentences > 0 ? current.slice(-overlapSentences) : [];
    const seedLength = seed.reduce((n, s) => n + s.length + 1, 0);
    const fits = seedLength < budget / 2;
    current = fits ? [...seed] : [];
    length = fits ? seedLength : 0;
  };

  for (const unit of units) {
    const added = current.length === 0 ? unit.length : length + 1 + unit.length;
    if (current.length > 0 && added > budget) {
      close();
      // The seed plus this sentence can still overrun; the sentence itself is what must survive.
      if (current.length > 0 && length + 1 + unit.length > budget) {
        current = [];
        length = 0;
      }
    }
    current.push(unit);
    length = current.length === 1 ? unit.length : length + 1 + unit.length;
  }

  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}
