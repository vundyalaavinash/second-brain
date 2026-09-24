// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
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

  it("carries the one action an event offers, and runs it where it was raised", async () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Placed 3 sessions, 1h 20m unplaced", action: { label: "Place tomorrow", onClick } } }));
    });
    expect(await screen.findByText("Placed 3 sessions, 1h 20m unplaced")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place tomorrow" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows no action button for a plain toast", async () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Nothing to place" } }));
    });
    expect(await screen.findByText("Nothing to place")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
