export interface GistProvider {
  /** Paraphrases already-selected quotes into one short paragraph. Never sees the whole source
   * document -- only the quotes `extract.ts` already verified as real -- so a genuinely small
   * model can do this adequately; it is summarizing 3-5 sentences, not reading a document. */
  gist(quotes: string[]): Promise<string>;
}
