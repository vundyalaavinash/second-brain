import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GistProvider } from "./types";

const run = promisify(execFile);

const SYSTEM = "Rewrite the following short quotes as one short, plain paragraph. Do not add anything that is not in the quotes.";

/** One inference call, one process, no server. `llama.cpp` mmaps the model file lazily, so this
 * costs disk space when idle and CPU/RAM only for the moment of this one call -- never a
 * persistent process the way a long-running server would be. */
export function createLlamaCppGistProvider(modelPath: string): GistProvider {
  return {
    async gist(quotes: string[]): Promise<string> {
      const prompt = `${SYSTEM}\n\n${quotes.map((q) => `- ${q}`).join("\n")}`;
      const { stdout } = await run("llama-cli", ["-m", modelPath, "-p", prompt, "-n", "120", "--no-display-prompt"]);
      return stdout.trim();
    },
  };
}
