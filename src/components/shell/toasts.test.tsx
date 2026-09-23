// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { ToastProvider } from "./toasts";

afterEach(cleanup);

describe("ToastProvider", () => {
  it("shows a toast sent as a window event", async () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Planned for today" } }));
    });
    expect(await screen.findByText("Planned for today")).toBeTruthy();
  });
});
