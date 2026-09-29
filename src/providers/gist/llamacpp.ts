import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { extractAnswer } from "../llama-cli-output";
import type { GistProvider } from "./types";

const run = promisify(execFile);

const SYSTEM = "Rewrite the following short quotes as one short, plain paragraph. Do not add anything that is not in the quotes.";

/** A single quiet-sweep gist is not worth stalling the serial job queue over; `JobWorker.start()`
 * runs jobs one at a time, so a hung `llama-cli` call would otherwise block transcription,
 * embedding, OCR, and the nightly backup along with it. */
const GIST_TIMEOUT_MS = 120_000;

/** One inference call, one process, no server. `llama.cpp` mmaps the model file lazily, so this
 * costs disk space when idle and CPU/RAM only for the moment of this one call -- never a
 * persistent process the way a long-running server would be. */
export function createLlamaCppGistProvider(modelPath: string, binPath: string): GistProvider {
  return {
    async gist(quotes: string[]): Promise<string> {
      const prompt = `${SYSTEM}\n\n${quotes.map((q) => `- ${q}`).join("\n")}`;
      // `--single-turn` is load-bearing: without it, current llama-cli builds drop into an
      // interactive chat REPL after answering once and never exit on their own, running until
      // GIST_TIMEOUT_MS kills them -- burning minutes of CPU on every single gist instead of the
      // few seconds this model actually needs.
      const { stdout } = await run(binPath, ["-m", modelPath, "-p", prompt, "-n", "120", "--no-display-prompt", "--single-turn"], {
        timeout: GIST_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      });
      return extractAnswer(stdout, prompt);
    },
  };
}
