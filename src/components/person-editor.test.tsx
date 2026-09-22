// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { PersonEditor } from "./person-editor";
import type { PersonDTO } from "@/lib/dto";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

// See item-editor.test.tsx: this vitest config has no global `afterEach`, so
// @testing-library/react's auto-cleanup never registers and a mounted RichEditor's window
// keydown listener would otherwise outlive this test.
afterEach(cleanup);

const person: PersonDTO = {
  id: 9,
  name: "Ada",
  slug: "ada",
  profile: "Bio.\n",
  itemCount: 0,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
};

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

describe("PersonEditor", () => {
  // The route trail contributes "People"; a parent on the page's own crumb would repeat it.
  it("portals just its title into the breadcrumb slot", () => {
    const slot = document.createElement("span");
    slot.id = "crumb-slot";
    document.body.appendChild(slot);
    try {
      render(<PersonEditor initial={person} />);
      expect(slot.textContent).toBe("/Ada");
      expect(slot.querySelector("a")).toBeNull();
    } finally {
      slot.remove();
    }
  });
});

describe("PersonEditor with RichEditor", () => {
  it("flushes the pending edit and saves the typed text on an immediate ⌘S", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ...person, profile: "x" }), { status: 200 });
        }
        return new Response(JSON.stringify(person), { status: 200 });
      }),
    );
    let editor: Editor | undefined;
    render(<PersonEditor initial={person} onEditorReady={(e) => (editor = e)} />);
    await waitForEditor(() => !!editor);
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
    expect((patches[0] as { profile: string }).profile).toContain("Bio. Typed just now");
    vi.unstubAllGlobals();
  });
});
