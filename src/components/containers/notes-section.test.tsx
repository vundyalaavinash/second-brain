// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { NotesSection, previewOf } from "./notes-section";
import type { ItemDTO } from "@/lib/dto";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

const note: ItemDTO = {
  id: 30, type: "note", title: "Meeting recap", body: "- talked about roadmap\n", status: "ready", error: null, sourceUrl: null,
  filePath: null, mimeType: null, extractedText: "", meta: {}, tags: [], journalDate: null, reviewWeek: null, containerId: 5,
  container: null, archivedAt: null, pinned: false, people: [], createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("NotesSection", () => {
  it("creates an empty untitled note and navigates to it", async () => {
    const calls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/items" && init?.method === "POST") {
          calls.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ...note, id: 99, title: "Untitled note", body: "" }), { status: 201 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
    render(<NotesSection containerId={5} initial={[note]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New note" }));
    });
    expect(calls[0]).toEqual({ type: "note", title: "Untitled note", body: "", containerId: 5 });
    expect(push).toHaveBeenCalledWith("/items/99");
  });

  it("shows the note title, a stripped preview, and the empty state when there are none", () => {
    const { rerender } = render(<NotesSection containerId={5} initial={[note]} />);
    expect(screen.getByText("Meeting recap")).toBeTruthy();
    expect(screen.getByText("talked about roadmap")).toBeTruthy();
    rerender(<NotesSection containerId={5} initial={[]} />);
    expect(screen.getByText("No notes yet.")).toBeTruthy();
  });

  it("hides the new note button when read-only", () => {
    render(<NotesSection containerId={5} initial={[note]} readOnly />);
    expect(screen.queryByRole("button", { name: "New note" })).toBeNull();
  });
});

describe("previewOf", () => {
  it("skips a heading that repeats the title and returns the next non-empty line", () => {
    expect(previewOf("# Title\n\nFirst para", "Title")).toBe("First para");
  });

  it("strips a task checkbox marker", () => {
    expect(previewOf("- [ ] Buy milk")).toBe("Buy milk");
  });

  it("strips a backslash-escaped callout marker", () => {
    expect(previewOf("> \\[!tip\\]\n> Try it")).toBe("Try it");
  });
});
