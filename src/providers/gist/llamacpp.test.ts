import { describe, it, expect, vi } from "vitest";
import { createLlamaCppGistProvider } from "./llamacpp";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => execFileMock(...args) }));
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return { ...actual, promisify: () => (...args: unknown[]) => execFileMock(...args) };
});

describe("createLlamaCppGistProvider", () => {
  it("runs the binary with the model path and the quotes as a prompt, returns trimmed stdout", async () => {
    execFileMock.mockResolvedValue({ stdout: "  A short paragraph about the quotes.  \n", stderr: "" });
    const provider = createLlamaCppGistProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    const gist = await provider.gist(["First quote.", "Second quote."]);
    expect(gist).toBe("A short paragraph about the quotes.");
    const [bin, argv, options] = execFileMock.mock.calls[0];
    expect(bin).toBe("/opt/homebrew/bin/llama-cli");
    expect(argv).toContain("-m");
    expect(argv).toContain("/path/to/model.gguf");
    // Without this, current llama-cli builds answer once and then wait on stdin forever instead
    // of exiting -- the bug this session found the hard way, burning CPU until the timeout.
    expect(argv).toContain("--single-turn");
    expect(options).toMatchObject({ timeout: 120_000, maxBuffer: 1024 * 1024 });
  });

  // Real `llama-cli` builds don't hand back clean stdout the way the mock above pretends --
  // there's a banner, an ASCII logo, and the prompt echoed back before the answer, then a stats
  // footer after it. This is what that actually looks like, captured from a real run.
  it("pulls just the answer out of the banner, the echoed prompt, and the stats footer", async () => {
    const prompt = "Rewrite the following short quotes as one short, plain paragraph. Do not add anything that is not in the quotes.\n\n- First quote.\n- Second quote.";
    const stdout = [
      "Loading model... |-\\|/-\\| ",
      "",
      "▄▄ ▄▄",
      "build      : b11146-7fe450e19",
      "model      : /path/to/model.gguf",
      "",
      "available commands:",
      "  /exit or Ctrl+C     stop or exit",
      "",
      `> ${prompt}`,
      "A short paragraph about the quotes.",
      "",
      "[ Prompt: 120.6 t/s | Generation: 191.8 t/s ]",
      "",
      "",
      "Exiting...",
    ].join("\n");
    execFileMock.mockResolvedValue({ stdout, stderr: "" });
    const provider = createLlamaCppGistProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    const gist = await provider.gist(["First quote.", "Second quote."]);
    expect(gist).toBe("A short paragraph about the quotes.");
  });

  it("propagates a failure from the binary rather than swallowing it", async () => {
    execFileMock.mockRejectedValue(new Error("binary not found"));
    const provider = createLlamaCppGistProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    await expect(provider.gist(["a quote"])).rejects.toThrow("binary not found");
  });
});
