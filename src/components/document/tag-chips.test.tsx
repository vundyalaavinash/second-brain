// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TagChips } from "./tag-chips";

afterEach(cleanup);

function Harness({ onChange }: { onChange: (v: string[]) => void }) {
  const [tags, setTags] = useState(["draft"]);
  return (
    <TagChips
      value={tags}
      onChange={(v) => {
        setTags(v);
        onChange(v);
      }}
    />
  );
}

describe("TagChips", () => {
  it("adds on Enter and comma, removes with the button and Backspace", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const input = screen.getByPlaceholderText("Tag") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["draft", "ideas"]);

    fireEvent.change(input, { target: { value: "later," } });
    expect(onChange).toHaveBeenLastCalledWith(["draft", "ideas", "later"]);

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["draft", "ideas"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove tag draft" }));
    expect(onChange).toHaveBeenLastCalledWith(["ideas"]);
  });
});
