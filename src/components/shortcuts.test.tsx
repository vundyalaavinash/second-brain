// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { Shortcuts } from "./shortcuts";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("Shortcuts", () => {
  it("calls the prompt bar on a bare c", () => {
    const focus = vi.fn();
    window.addEventListener("sb:prompt-focus", focus);
    render(<Shortcuts />);
    fireEvent.keyDown(window, { key: "c" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    window.removeEventListener("sb:prompt-focus", focus);
  });

  it("leaves the c in g c to the capture route, and stays out of a field", () => {
    const focus = vi.fn();
    window.addEventListener("sb:prompt-focus", focus);
    render(<Shortcuts />);
    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "c" });
    expect(push).toHaveBeenCalledWith("/capture");
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "c" });
    input.remove();
    expect(focus).not.toHaveBeenCalled();
    window.removeEventListener("sb:prompt-focus", focus);
  });
});
