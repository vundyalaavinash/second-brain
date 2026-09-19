// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { RichEditor, RichEditorFallback } from "./rich-editor";

// This file's vitest config has no global `afterEach`, so @testing-library/react's own
// auto-cleanup never registers; without it a mounted RichEditor's window keydown listener
// would outlive its test.
afterEach(cleanup);

function Boom(): never {
  throw new Error("boom");
}

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

describe("RichEditorFallback", () => {
  it("shows a working plain textarea when the wrapped editor throws", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const { getByPlaceholderText, rerender } = render(
      <RichEditorFallback value="Hello" onChange={onChange} placeholder="Write something">
        <Boom />
      </RichEditorFallback>,
    );
    const textarea = getByPlaceholderText("Write something") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello");

    fireEvent.change(textarea, { target: { value: "Hello there" } });
    expect(onChange).toHaveBeenCalledWith("Hello there");

    rerender(
      <RichEditorFallback value="Replaced" onChange={onChange} placeholder="Write something">
        <Boom />
      </RichEditorFallback>,
    );
    expect(textarea.value).toBe("Replaced");

    errorSpy.mockRestore();
  });
});
