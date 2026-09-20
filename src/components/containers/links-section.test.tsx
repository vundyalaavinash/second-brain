// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent, act, cleanup } from "@testing-library/react";
import { LinksSection } from "./links-section";
import type { ItemDTO } from "@/lib/dto";

// This vitest config has no global `afterEach`, so @testing-library/react's own auto-cleanup
// never registers and DOM from one `it` would otherwise still be attached in the next.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const link: ItemDTO = {
  id: 10, type: "link", title: "https://example.com/post", body: "", status: "ready", error: null,
  sourceUrl: "https://example.com/post", filePath: null, mimeType: null, extractedText: "", meta: {}, tags: [],
  journalDate: null, reviewWeek: null, containerId: 5, container: null, archivedAt: null, pinned: false, people: [],
  createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(handler));
}

describe("LinksSection", () => {
  it("pastes a link and adds it to the list on Enter", async () => {
    const calls: unknown[] = [];
    stub(async (url, init) => {
      if (url === "/api/items" && init?.method === "POST") {
        calls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ...link, id: 11, sourceUrl: "https://foo.dev/x", title: "https://foo.dev/x" }), { status: 201 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<LinksSection containerId={5} initial={[]} />);
    const input = screen.getByPlaceholderText("Paste a link") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://foo.dev/x" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(calls[0]).toEqual({ type: "link", url: "https://foo.dev/x", containerId: 5 });
    expect(await screen.findByText("https://foo.dev/x")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("shows already captured on a 409 duplicate", async () => {
    stub(async (url, init) => {
      if (url === "/api/items" && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "This link is already saved", existingId: 42 }), { status: 409 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<LinksSection containerId={5} initial={[]} />);
    const input = screen.getByPlaceholderText("Paste a link") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://dup.example.com" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    });
    expect(await screen.findByText("Already captured.")).toBeTruthy();
    const viewLink = screen.getByRole("link", { name: "View it" }) as HTMLAnchorElement;
    expect(viewLink.getAttribute("href")).toBe("/items/42");
  });

  it("stars a link, moves it first, and reverts on a failed patch", async () => {
    const other: ItemDTO = { ...link, id: 20, title: "https://z.example.com", sourceUrl: "https://z.example.com", createdAt: "2026-09-17T00:00:00.000Z" };
    const patches: unknown[] = [];
    let fail = false;
    stub(async (url, init) => {
      if (init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        if (fail) return new Response(JSON.stringify({ error: "nope" }), { status: 500 });
        return new Response(JSON.stringify({ ...link, pinned: true }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    render(<LinksSection containerId={5} initial={[link, other]} />);
    // `link` (id 10) is older than `other` (id 20), so it starts second.
    let rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("z.example.com");
    const star = within(rows[1]).getByRole("button", { name: "Star" });
    await act(async () => {
      fireEvent.click(star);
    });
    expect(patches).toEqual([{ pinned: true }]);
    rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("example.com/post");

    fail = true;
    const unstar = within(rows[0]).getByRole("button", { name: "Unstar" });
    await act(async () => {
      fireEvent.click(unstar);
    });
    await screen.findByText("Could not save that change");
    rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toContain("example.com/post");
  });

  it("hides the paste box and disables star buttons when read-only", () => {
    render(<LinksSection containerId={5} initial={[link]} readOnly />);
    expect(screen.queryByPlaceholderText("Paste a link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add link" })).toBeNull();
    const star = screen.getByRole("button", { name: "Star" }) as HTMLButtonElement;
    expect(star.disabled).toBe(true);
  });
});
