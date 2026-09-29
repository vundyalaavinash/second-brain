import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ChatProvider, StructuredRequest } from "./types";
import { jsonSchemaToGrammar } from "./json-schema-to-gbnf";
import { extractAnswer } from "../llama-cli-output";

const run = promisify(execFile);

/** A transcript can run long, and a 7B model reasoning over one is minutes, not seconds --
 * generous, but this still has to give up eventually rather than stall the serial job queue
 * (JobWorker.start() runs one job at a time) behind a single meeting forever. */
const SUMMARY_TIMEOUT_MS = 10 * 60 * 1000;

/** The prompt echoes the whole user message back (a full transcript, for this app's one caller)
 * before the answer, so stdout can be much larger than a short gist's ever was. */
const MAX_BUFFER = 10 * 1024 * 1024;

/** How many tokens the answer itself is allowed -- a summary, a handful of decisions, a handful
 * of proposed actions is a few hundred words at most, never a full second transcript. */
const MAX_ANSWER_TOKENS = 800;

/**
 * One inference call, one process, no server -- the same shape as the gist provider
 * (src/providers/gist/llamacpp.ts), and the same `llama-cli` binary, just a bigger model and a
 * grammar instead of a plain-paragraph prompt. The obvious way to constrain output to a schema
 * is `--json-schema-file`, which asks `llama-cli` to derive the grammar itself -- but on this
 * build that fails with "Failed to initialize samplers" the instant it is used, on any schema,
 * with or without --single-turn. The identical grammar it *would* have derived works perfectly
 * handed to `--grammar-file` directly (confirmed by hand), so `jsonSchemaToGrammar` does that
 * conversion here instead and feeds the result through the path that actually works. The Zod
 * `.parse()` at the end is a second, independent check that what came out still means what the
 * schema says, not just that the grammar was satisfied.
 */
export function createLlamaCppChatProvider(modelPath: string, binPath: string): ChatProvider {
  return {
    async structured<T>(req: StructuredRequest<T>): Promise<T> {
      const grammar = jsonSchemaToGrammar(z.toJSONSchema(req.schema as z.ZodType));
      const grammarFile = path.join(os.tmpdir(), `sb-summary-grammar-${randomUUID()}.gbnf`);
      await fs.promises.writeFile(grammarFile, grammar);
      try {
        const prompt = [req.system, "", req.user, "", "Respond with a single JSON object matching the required schema, nothing else."].join("\n");
        // See src/providers/gist/llamacpp.ts: `--single-turn` keeps current llama-cli builds from
        // dropping into an interactive REPL that never exits on its own.
        const { stdout } = await run(
          binPath,
          ["-m", modelPath, "-p", prompt, "-n", String(MAX_ANSWER_TOKENS), "--no-display-prompt", "--single-turn", "--grammar-file", grammarFile],
          { timeout: SUMMARY_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
        );
        const answer = extractAnswer(stdout, prompt);
        const parsed: unknown = JSON.parse(answer);
        return req.schema.parse(parsed) as T;
      } finally {
        await fs.promises.unlink(grammarFile).catch(() => {});
      }
    },
  };
}
