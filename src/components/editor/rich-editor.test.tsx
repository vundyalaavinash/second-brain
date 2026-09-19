// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { RichEditor } from "./rich-editor";

async function mount(value: string, onChange = vi.fn()) {
  let editor: Editor | undefined;
  const utils = render(<RichEditor value={value} onChange={onChange} onReady={(e) => (editor = e)} />);
  for (let i = 0; i < 10 && !editor; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  if (!editor) throw new Error("editor did not mount");
  return { editor, onChange, ...utils };
}

describe("RichEditor", () => {
  it("does not emit on mount and emits debounced markdown after typing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { editor, onChange } = await mount("# Title\n\nHello.\n");
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { editor.commands.focus("end"); editor.commands.insertContent(" World"); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("Hello. World");
    vi.useRealTimers();
  });

  it("replaces content on an external value change without emitting", async () => {
    const onChange = vi.fn();
    const { editor, rerender } = await mount("One\n", onChange);
    rerender(<RichEditor value={"Two\n"} onChange={onChange} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(editor.getText()).toBe("Two");
    expect(onChange).not.toHaveBeenCalled();
  });
});
