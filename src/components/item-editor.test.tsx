// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, screen, fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { ItemEditor } from "./item-editor";
import type { ItemDTO } from "@/lib/dto";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// This file's vitest config does not enable global test APIs, so @testing-library/react's
// own auto-cleanup (which detects a global `afterEach`) never registers. Without an explicit
// cleanup, a mounted RichEditor's window-level keydown listener outlives its test and fires
// again during a later test in this file, so unmount every render before the next test runs.
afterEach(cleanup);

const item: ItemDTO = {
  id: 4, type: "note", title: "T", body: "Hello.\n", status: "ready", error: null, sourceUrl: null, filePath: null, mimeType: null,
  extractedText: "", meta: {}, tags: [], journalDate: null, reviewWeek: null, containerId: null, container: null, archivedAt: null,
  pinned: false, people: [], createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:00.000Z",
};

// RichEditor debounces markdown emission 300ms after the last keystroke (EMIT_DEBOUNCE_MS in
// rich-editor.tsx); ItemEditor then debounces the actual PATCH SAVE_DEBOUNCE_MS = 5000ms after
// that (item-editor.tsx). Both are host/editor behaviour frozen by this task, so the test waits
// out the real sum rather than a shortened one.
const EMIT_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 5000;

// Polls a deadline rather than a fixed number of ticks: under full-suite parallel load the
// next/dynamic-loaded editor can take longer than a short fixed budget to mount.
const MOUNT_TIMEOUT_MS = 5000;
const MOUNT_POLL_MS = 20;

async function waitForEditor(hasEditor: () => boolean): Promise<void> {
  const deadline = Date.now() + MOUNT_TIMEOUT_MS;
  while (!hasEditor()) {
    if (Date.now() >= deadline) throw new Error("editor did not mount within 5 s");
    await act(async () => { await new Promise((r) => setTimeout(r, MOUNT_POLL_MS)); });
  }
}

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
    await waitForEditor(() => !!editor);
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

  it("flushes the pending edit and saves exactly once on ⌘S, before RichEditor's own debounce would fire", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ...item, body: "x" }), { status: 200 }); }
      return new Response(JSON.stringify(item), { status: 200 });
    }));
    let editor: Editor | undefined;
    render(<ItemEditor initial={item} onEditorReady={(e) => (editor = e)} />);
    await waitForEditor(() => !!editor);
    await act(async () => { editor!.commands.focus("end"); editor!.commands.insertContent(" Saved by cmd s"); });
    // Dispatch well inside RichEditor's own 300ms emit debounce, so the PATCH can only have
    // come from the ⌘S flush, not from the debounce elapsing naturally.
    await act(async () => { vi.advanceTimersByTime(80); });
    // Dispatched on document (not window) so window's listeners see distinct capture/bubble
    // phases, the same as a real keydown whose target is a DOM node inside the page.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(1);
    expect((patches[0] as { body: string }).body).toContain("Hello. Saved by cmd s");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // The rail portals into the shell's slot, so the test supplies one; without it Rail renders
  // nothing, which is what every other case in this file relies on.
  it("lists the body's headings in the rail's outline", () => {
    const slot = document.createElement("div");
    slot.id = "rail-slot";
    document.body.appendChild(slot);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(item), { status: 200 })));
      render(<ItemEditor initial={{ ...item, body: "# Title\n\n## Part one\n" }} />);
      expect(screen.getByRole("button", { name: "Part one" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Title" })).toBeTruthy();
      vi.unstubAllGlobals();
    } finally {
      cleanup();
      slot.remove();
    }
  });

  it("flushes a tag added through TagChips and saves exactly once on ⌘S", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(JSON.stringify({ ...item, body: "x" }), { status: 200 }); }
      return new Response(JSON.stringify(item), { status: 200 });
    }));
    render(<ItemEditor initial={item} />);
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByPlaceholderText("Tag");
    fireEvent.change(input, { target: { value: "ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await act(async () => { vi.advanceTimersByTime(80); });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(1);
    expect((patches[0] as { tags: string[] }).tags).toContain("ideas");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows a pending distillation's offer and PATCHes the distillation route, not the item's own, on Keep", async () => {
    const withDistillation: ItemDTO = {
      ...item,
      distillation: { gist: "A short paragraph.", quotes: ["First quote"], generatedAt: "now", status: "pending" },
    };
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify({ ...withDistillation, distillation: { ...withDistillation.distillation, status: "kept" } }), { status: 200 });
        }
        return new Response(JSON.stringify(withDistillation), { status: 200 });
      }),
    );
    render(<ItemEditor initial={withDistillation} />);
    expect(screen.getByText("A short paragraph.")).toBeTruthy();
    expect(screen.getByText("First quote")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /keep/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(patch?.url).toBe(`/api/items/${item.id}/distillation`);
    expect(JSON.parse(String(patch?.init?.body))).toEqual({ status: "kept" });
    vi.unstubAllGlobals();
  });
});
