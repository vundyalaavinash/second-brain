/** The line that opens `llama-cli`'s stats footer -- present whether or not the model actually
 * has anything to say, so it is the one thing this build's output reliably has after the answer. */
const STATS_FOOTER = "\n[ Prompt:";

/** What current `llama-cli` builds print in place of a long prompt's echo -- the terminal UI
 * truncates the display rather than showing it in full (the model itself still sees the whole
 * thing; this is purely a display choice), so an exact match against the prompt this call sent
 * finds nothing once that prompt runs past whatever length triggers it. Found the hard way: a
 * short gist prompt (a handful of quotes) never hits this, a full meeting transcript reliably
 * does. */
const TRUNCATED_MARKER = "(truncated)";

/** Current `llama-cli` builds are a chat REPL, not the plain completion tool both providers that
 * call this were written against: stdout opens with a banner, an ASCII logo and a build/model
 * summary, then echoes the prompt back after its own `>` marker (in full for a short prompt, cut
 * off with "(truncated)" for a long one), then the answer, then the stats footer. None of
 * `--no-display-prompt`/`--log-disable`/`--simple-io` suppress the banner or the echo in this
 * build, so rather than chase whichever flag this version happens to respect, this looks for the
 * one span guaranteed to be there: everything between wherever the echoed prompt ends -- the
 * literal prompt if it is short enough to appear in full, the truncation marker if it is not --
 * and the stats footer that always follows the answer. Falls back to the whole, untouched output
 * if none of those markers are found, so a further CLI change degrades to noisy rather than
 * silently wrong. */
export function extractAnswer(stdout: string, prompt: string): string {
  const footerAt = stdout.indexOf(STATS_FOOTER);
  const body = footerAt === -1 ? stdout : stdout.slice(0, footerAt);

  const afterPrompt = body.lastIndexOf(prompt);
  if (afterPrompt !== -1) return body.slice(afterPrompt + prompt.length).trim();

  const afterTruncated = body.lastIndexOf(TRUNCATED_MARKER);
  if (afterTruncated !== -1) return body.slice(afterTruncated + TRUNCATED_MARKER.length).trim();

  return body.trim();
}
