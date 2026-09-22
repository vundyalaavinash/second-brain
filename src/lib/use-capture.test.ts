// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useCapture } from "./use-capture";

// The hook hands back a module constant, so one mount is enough for the whole file.
function capture(): ReturnType<typeof useCapture> {
  return renderHook(() => useCapture()).result.current;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("uploadFiles", () => {
  it("posts each file as form data with the container it was dropped into", async () => {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push([url, init]);
        return new Response(JSON.stringify({ id: 42, type: "file", title: "notes.txt" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    const created = await capture().uploadFiles([file], { containerId: 4 });

    expect(created).toEqual([{ id: 42, type: "file", title: "notes.txt" }]);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0];
    expect(url).toBe("/api/upload");
    expect(init?.method).toBe("POST");
    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("file")).toBe(file);
    // The id travels as a form field, so it reaches the route as a string.
    expect(body.get("containerId")).toBe("4");
  });

  it("raises the endpoint's own message when an upload is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "File too large" }), { status: 413, headers: { "content-type": "application/json" } })),
    );
    await expect(capture().uploadFiles([new File(["x"], "big.bin")])).rejects.toThrow("File too large");
  });
});

describe("captureLink", () => {
  it("answers a 409 with the item the library already holds rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ existingId: 7 }), { status: 409, headers: { "content-type": "application/json" } })),
    );

    const result = await capture().captureLink("https://example.com/x");

    expect(result).toEqual({ duplicate: 7 });
  });
});
