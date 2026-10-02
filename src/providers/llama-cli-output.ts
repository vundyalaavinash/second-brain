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

/** A refused prompt, as this build words it. Both numbers are worth keeping: the limit alone does
 * not say how much too long the input was, which is the thing a caller has to act on. */
const CONTEXT_OVERFLOW = /request \((\d+) tokens\) exceeds the available context size \((\d+) tokens\)/;

/** How `llama-cli` prefixes any error it puts on stdout. The colon matters -- an answer may well
 * open with the word "Error" and still be a perfectly good answer. */
const ERROR_PREFIX = "Error: ";

/**
 * A prompt `llama-cli` would not accept, carrying both numbers it reported. Typed rather than a
 * plain Error because it is the one failure a caller can do something about: knowing the prompt
 * was 44,233 tokens against a 32,768-token window is what lets the summary job split a transcript
 * into parts that fit, and calibrate the split against this transcript rather than a guessed
 * characters-per-token constant.
 */
export class ContextOverflowError extends Error {
  readonly name = "ContextOverflowError";
  constructor(
    readonly promptTokens: number,
    readonly contextTokens: number,
  ) {
    super(`the prompt is ${promptTokens} tokens but this model's context window is ${contextTokens} tokens`);
  }
}

/**
 * Whether what came back is `llama-cli` reporting a failure rather than answering, and if so the
 * error to raise. Null means it really is an answer.
 *
 * This exists because `llama-cli` writes the failure to stdout and **exits 0**, so `execFile`
 * resolves and nothing upstream can tell the difference. Measured against the real summary model:
 * a 44,233-token transcript against its 32,768-token window exits 0 in 1.5s with no answer at all.
 * Without this check the summary provider reports "Unexpected token 'E', "Error: req"... is not
 * valid JSON" -- true, useless, and hiding the actual cause -- and the gist provider is worse
 * still, because it does not parse what it gets back and would store the error text as the gist.
 *
 * Note what llama-cli does *not* do: it refuses the whole request rather than dropping the tokens
 * that do not fit. Nothing is silently summarised from a partial transcript, which is why this is
 * a reporting fix and not a correctness one.
 */
export function llamaCliError(answer: string): Error | null {
  const overflow = CONTEXT_OVERFLOW.exec(answer);
  if (overflow) return new ContextOverflowError(Number(overflow[1]), Number(overflow[2]));

  const trimmed = answer.trim();
  if (trimmed.startsWith(ERROR_PREFIX)) return new Error(`llama-cli failed: ${trimmed.slice(ERROR_PREFIX.length).trim()}`);

  return null;
}
