import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

// Mocked so this test never actually raises the Calendar app: `execFile` is what the route's
// `run("open", ["-a", "Calendar"])` resolves through (via `promisify`), so replacing it here is
// enough to keep this test's assertions about *what* would be run without ever running it.
const execFileMock = vi.fn((_file: string, _args: string[], callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void) => {
  callback(null, { stdout: "", stderr: "" });
});
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

let route: typeof import("./route");

beforeAll(async () => {
  route = await import("./route");
});

afterEach(() => execFileMock.mockClear());

const post = (origin?: string) => new Request("http://localhost/api/meetings/open-calendar", { method: "POST", headers: origin ? { origin } : undefined });

describe("POST /api/meetings/open-calendar", () => {
  it("opens the Calendar app with a literal argv -- no request input is ever read", async () => {
    const res = await route.POST(post());
    expect(res.status).toBe(204);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(execFileMock.mock.calls[0][0]).toBe("open");
    expect(execFileMock.mock.calls[0][1]).toEqual(["-a", "Calendar"]);
  });

  it("gates on the same-origin guard, and never shells out at all", async () => {
    const res = await route.POST(post("https://evil.example"));
    expect(res.status).toBe(403);
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
