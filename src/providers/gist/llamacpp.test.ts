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
    expect(options).toMatchObject({ timeout: 120_000, maxBuffer: 1024 * 1024 });
  });

  it("propagates a failure from the binary rather than swallowing it", async () => {
    execFileMock.mockRejectedValue(new Error("binary not found"));
    const provider = createLlamaCppGistProvider("/path/to/model.gguf", "/opt/homebrew/bin/llama-cli");
    await expect(provider.gist(["a quote"])).rejects.toThrow("binary not found");
  });
});
