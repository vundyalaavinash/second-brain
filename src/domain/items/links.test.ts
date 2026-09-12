import { describe, it, expect } from "vitest";
import { ARTICLE_HTML } from "@/test/fixtures";
import { extractReadable, fetchPage } from "./links";

describe("extractReadable", () => {
  it("extracts the article title and body text", () => {
    const page = extractReadable(ARTICLE_HTML, "https://example.test/post");
    expect(page.title).toMatch(/Test Article/);
    expect(page.text.startsWith("The second brain keeps")).toBe(true);
    expect(page.text).not.toMatch(/copyright/);
    expect(page.text.length).toBeGreaterThan(1000);
  });

  it("falls back to the body text and document title for thin pages", () => {
    const page = extractReadable("<html><head><title>Tiny</title></head><body><p>hi there</p></body></html>", "https://t.test");
    expect(page.title).toBe("Tiny");
    expect(page.text).toBe("hi there");
  });

  it("uses the url as the title when the page has none", () => {
    const page = extractReadable("<html><body>x</body></html>", "https://t.test/a");
    expect(page.title).toBe("https://t.test/a");
  });
});

describe("fetchPage", () => {
  it("sends a browser-like user agent and rejects non-2xx", async () => {
    let seenUa = "";
    const ok: typeof fetch = async (_url, init) => {
      seenUa = String((init?.headers as Record<string, string>)["user-agent"]);
      return new Response(ARTICLE_HTML, { status: 200, headers: { "content-type": "text/html" } });
    };
    const page = await fetchPage("https://example.test/post", ok);
    expect(page.title).toMatch(/Test Article/);
    expect(seenUa).toMatch(/Mozilla/);

    const bad: typeof fetch = async () => new Response("nope", { status: 404 });
    await expect(fetchPage("https://example.test/missing", bad)).rejects.toThrow(/404/);
  });
});
