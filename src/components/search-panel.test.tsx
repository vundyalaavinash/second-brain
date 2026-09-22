// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { SearchPanel } from "./search-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockFetch(body: unknown = []) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("SearchPanel", () => {
  it("searches by the initial tag on load, with no typed query", async () => {
    const fetchFn = mockFetch();
    render(<SearchPanel initialTag="work" />);
    await waitFor(() => {
      const calls = fetchFn.mock.calls as unknown as [string][];
      expect(calls.some(([url]) => url.startsWith("/api/search"))).toBe(true);
    });
    const calls = fetchFn.mock.calls as unknown as [string][];
    const [url] = calls.find(([u]) => u.startsWith("/api/search"))!;
    expect(url).toContain("tag=work");
  });
});
