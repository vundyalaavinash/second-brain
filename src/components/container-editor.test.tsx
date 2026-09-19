// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { ContainerEditor } from "./container-editor";
import type { ContainerDTO } from "@/lib/dto";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// See item-editor.test.tsx / person-editor.test.tsx: this vitest config has no global
// `afterEach`, so @testing-library/react's auto-cleanup never registers and a mounted
// RichEditor's window keydown listener would otherwise outlive this test.
afterEach(cleanup);

const container: ContainerDTO = {
  id: 5,
  kind: "area",
  name: "Health",
  slug: "health",
  description: "Bio.\n",
  status: "active",
  goal: "",
  deadline: null,
  standard: "",
  category: null,
  nextSteps: "",
  sortOrder: 0,
  archivedAt: null,
  itemCount: 0,
  totalItemCount: 0,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("ContainerEditor with RichEditor", () => {
  it("flushes the pending description edit and saves it on an immediate ⌘S", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ...container, description: "x" }), { status: 200 });
        }
        return new Response(JSON.stringify(container), { status: 200 });
      }),
    );
    let editor: Editor | undefined;
    render(<ContainerEditor initial={container} items={[]} onEditorReady={(e) => (editor = e)} />);
    for (let i = 0; i < 20 && !editor; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(0);
    await act(async () => {
      editor!.commands.focus("end");
      editor!.commands.insertContent(" Typed just now");
    });
    // No wait for RichEditor's own 300ms emit debounce: ⌘S must flush it itself.
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(patches).toHaveLength(1);
    expect((patches[0] as { description: string }).description).toContain("Bio. Typed just now");
    vi.unstubAllGlobals();
  });
});
