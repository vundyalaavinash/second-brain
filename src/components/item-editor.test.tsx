// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { ItemEditor } from "./item-editor";
import type { ItemDTO } from "@/lib/dto";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const item: ItemDTO = {
  id: 4, type: "note", title: "T", body: "Hello.\n", status: "ready", error: null, sourceUrl: null, filePath: null, mimeType: null,
  extractedText: "", meta: {}, tags: [], journalDate: null, reviewWeek: null, containerId: null, container: null, archivedAt: null,
  people: [], createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

// RichEditor debounces markdown emission 300ms after the last keystroke (EMIT_DEBOUNCE_MS in
// rich-editor.tsx); ItemEditor then debounces the actual PATCH SAVE_DEBOUNCE_MS = 5000ms after
// that (item-editor.tsx). Both are host/editor behaviour frozen by this task, so the test waits
// out the real sum rather than a shortened one.
const EMIT_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 5000;

describe("ItemEditor with RichEditor", () => {
  it("sends the same PATCH the textarea sent, once, after typing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ...item, body: "x" }), { status: 200 }); }
      return new Response(JSON.stringify(item), { status: 200 });
    }));
    let editor: Editor | undefined;
    render(<ItemEditor initial={item} onEditorReady={(e) => (editor = e)} />);
    for (let i = 0; i < 20 && !editor; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(0);
    await act(async () => { editor!.commands.focus("end"); editor!.commands.insertContent(" World"); });
    // Two separate advances, not one: the first lets RichEditor's own 300ms debounce fire and
    // React flush the resulting setBody/markDirty render before the second lets ItemEditor's
    // 5000ms save debounce fire and read the now-current body from its ref.
    await act(async () => { vi.advanceTimersByTime(EMIT_DEBOUNCE_MS + 50); });
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100); });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ title: "T", tags: [] });
    expect((patches[0] as { body: string }).body).toContain("Hello. World");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
