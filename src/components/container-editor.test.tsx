// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
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
  sortOrder: 0,
  archivedAt: null,
  itemCount: 0,
  totalItemCount: 0,
  progress: { open: 0, done: 0, total: 0, percent: 0, nextTask: null },
  pinnedLinks: [],
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

// RichEditor debounces markdown emission 300ms after the last keystroke (EMIT_DEBOUNCE_MS in
// rich-editor.tsx); ContainerEditor then debounces the actual PATCH SAVE_DEBOUNCE_MS = 2000ms
// after that (container-editor.tsx). Both are host/editor behaviour frozen by this task, so the
// test waits out the real sum rather than a shortened one.
const EMIT_DEBOUNCE_MS = 300;
const SAVE_DEBOUNCE_MS = 2000;

const project: ContainerDTO = {
  ...container,
  id: 7,
  kind: "project",
  name: "Launch",
  slug: "launch",
  goal: "",
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
    render(<ContainerEditor initial={container} items={[]} tasks={[]} today="2026-09-16" onEditorReady={(e) => (editor = e)} />);
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
    expect((patches[0] as { description: string }).description).toContain("Bio. Typed just now");
    vi.unstubAllGlobals();
  });

  it("sends exactly one PATCH 2s after the editor's own debounce, without pressing anything", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
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
    render(<ContainerEditor initial={container} items={[]} tasks={[]} today="2026-09-16" onEditorReady={(e) => (editor = e)} />);
    await waitForEditor(() => !!editor);
    expect(patches).toHaveLength(0);
    await act(async () => {
      editor!.commands.focus("end");
      editor!.commands.insertContent(" Autosaved");
    });
    // Two separate advances, not one: the first lets RichEditor's own 300ms debounce fire and
    // React flush the resulting setDescription/markDirty render before the second lets
    // ContainerEditor's 2000ms save debounce fire and read the now-current description from its ref.
    await act(async () => { vi.advanceTimersByTime(EMIT_DEBOUNCE_MS + 50); });
    await act(async () => { vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100); });
    expect(patches).toHaveLength(1);
    expect((patches[0] as { description: string }).description).toContain("Bio. Autosaved");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("flushes immediately when the goal input blurs while dirty", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ ...project, goal: "Ship it" }), { status: 200 });
        }
        return new Response(JSON.stringify(project), { status: 200 });
      }),
    );
    let editor: Editor | undefined;
    const { getByPlaceholderText } = render(
      <ContainerEditor initial={project} items={[]} tasks={[]} today="2026-09-16" onEditorReady={(e) => (editor = e)} />,
    );
    await waitForEditor(() => !!editor);
    const goalInput = getByPlaceholderText("What does done look like?");
    fireEvent.change(goalInput, { target: { value: "Ship it" } });
    expect(patches).toHaveLength(0);
    await act(async () => {
      fireEvent.blur(goalInput);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(patches).toHaveLength(1);
    expect((patches[0] as { goal: string }).goal).toBe("Ship it");
    vi.unstubAllGlobals();
  });
});
