import fs from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { createLlamaCppChatProvider } from "./llamacpp";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return { ...actual, promisify: () => (...args: unknown[]) => execFileMock(...args) };
});

afterEach(() => {
  execFileMock.mockReset();
});

const Schema = z.object({
  summary: z.string().describe("One short paragraph."),
  decisions: z.array(z.string()).describe("What the meeting settled."),
});

const REQUEST = { system: "You summarise meetings.", user: "Transcript: we shipped it.", schema: Schema, name: "record_meeting_summary" };

describe("createLlamaCppChatProvider", () => {
  it("runs the binary with the model path, a grammar file, and single-turn, returning the parsed answer", async () => {
    const answer = { summary: "The team shipped the feature.", decisions: ["Ship now"] };
    // Read the grammar file from inside the mock, while the call that wrote it is still in
    // flight -- the provider cleans it up in a `finally` the instant execFile resolves, so
    // reading it back afterward would just find it already gone.
    let grammarFile = "";
    let grammarOnDisk = "";
    execFileMock.mockImplementation((_bin: string, argv: string[]) => {
      grammarFile = argv[argv.indexOf("--grammar-file") + 1];
      grammarOnDisk = fs.readFileSync(grammarFile, "utf8");
      return Promise.resolve({ stdout: JSON.stringify(answer), stderr: "" });
    });
    const provider = createLlamaCppChatProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    const result = await provider.structured(REQUEST);
    expect(result).toEqual(answer);

    const [bin, argv, options] = execFileMock.mock.calls[0];
    expect(bin).toBe("/opt/homebrew/bin/llama-cli");
    expect(argv).toContain("-m");
    expect(argv).toContain("/path/to/model.gguf");
    // Same bug this session found the hard way for the gist provider: without this, current
    // llama-cli builds answer once and then wait on stdin forever instead of exiting.
    expect(argv).toContain("--single-turn");
    // `--json-schema-file` was the obvious flag for this and is what the first version of this
    // provider used -- it fails with "Failed to initialize samplers" on this build, on any
    // schema, so this goes through a grammar file this provider derives itself instead (see
    // json-schema-to-gbnf.ts). The two required properties both need to show up somewhere in it.
    expect(grammarOnDisk).toContain('\\"summary\\"');
    expect(grammarOnDisk).toContain('\\"decisions\\"');
    // The grammar file is scratch, written for this one call -- it must not still be there after.
    expect(fs.existsSync(grammarFile)).toBe(false);
    expect(options).toMatchObject({ timeout: 10 * 60 * 1000 });
  });

  // Real `llama-cli` builds wrap the answer in a banner, an echoed prompt, and a stats footer --
  // the same shape src/providers/gist/llamacpp.test.ts exercises for the gist provider.
  it("pulls the JSON answer out of the banner, the echoed prompt, and the stats footer", async () => {
    const answer = { summary: "The team shipped the feature.", decisions: ["Ship now"] };
    const prompt = [REQUEST.system, "", REQUEST.user, "", "Respond with a single JSON object matching the required schema, nothing else."].join("\n");
    const stdout = ["Loading model... |-\\|/-\\| ", "", "▄▄ ▄▄", "", `> ${prompt}`, JSON.stringify(answer), "", "[ Prompt: 12.0 t/s | Generation: 8.0 t/s ]", "", "", "Exiting..."].join(
      "\n",
    );
    execFileMock.mockResolvedValue({ stdout, stderr: "" });
    const provider = createLlamaCppChatProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    const result = await provider.structured(REQUEST);
    expect(result).toEqual(answer);
  });

  it("rejects an answer that parses as JSON but does not match the schema", async () => {
    execFileMock.mockResolvedValue({ stdout: JSON.stringify({ summary: 42 }), stderr: "" });
    const provider = createLlamaCppChatProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    await expect(provider.structured(REQUEST)).rejects.toThrow();
  });

  it("rejects an answer that is not valid JSON at all", async () => {
    execFileMock.mockResolvedValue({ stdout: "not json", stderr: "" });
    const provider = createLlamaCppChatProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    await expect(provider.structured(REQUEST)).rejects.toThrow();
  });

  it("propagates a failure from the binary rather than swallowing it", async () => {
    execFileMock.mockRejectedValue(new Error("binary not found"));
    const provider = createLlamaCppChatProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    await expect(provider.structured(REQUEST)).rejects.toThrow("binary not found");
  });
});
