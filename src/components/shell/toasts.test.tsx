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
    // Its offer taken, the toast goes: leaving it up would invite the same click twice.
    expect(screen.queryByText("Placed 3 sessions, 1h 20m unplaced")).toBeNull();
  });

  it("offers an action outside the words it announces, and a way to put the toast away", async () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Placed 3 sessions", action: { label: "Place tomorrow", onClick: vi.fn() } } }));
    });
    const live = await screen.findByRole("status");
    // The live region announces the text and nothing else: the buttons are its siblings.
    expect(live.textContent).toBe("Placed 3 sessions");
    expect(live.querySelector("button")).toBeNull();
    const action = screen.getByRole("button", { name: "Place tomorrow" });
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Placed 3 sessions")).toBeNull();
  });

  it("takes the newest toast's action from the keyboard, and Escape puts it away", async () => {
    const onClick = vi.fn();
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Placed 3 sessions, 1h 20m unplaced", action: { label: "Place tomorrow", onClick } } }));
    });
    await screen.findByText("Placed 3 sessions, 1h 20m unplaced");
    act(() => {
      fireEvent.keyDown(window, { key: ".", metaKey: true });
    });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Placed 3 sessions, 1h 20m unplaced")).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Nothing to place" } }));
    });
    await screen.findByText("Nothing to place");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByText("Nothing to place")).toBeNull();
  });

  it("keeps an actionable toast up four times as long as a plain one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      render(
        <ToastProvider>
          <span />
        </ToastProvider>,
      );
      act(() => {
        window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Nothing to place" } }));
        window.dispatchEvent(new CustomEvent("sb:toast", { detail: { text: "Placed 3 sessions", action: { label: "Place tomorrow", onClick: vi.fn() } } }));
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      // Five seconds is the plain toast's whole life; the one with an offer is still there.
      expect(screen.queryByText("Nothing to place")).toBeNull();
      expect(screen.getByText("Placed 3 sessions")).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(15_000);
      });
      expect(screen.queryByText("Placed 3 sessions")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
    // Only the dismiss: nothing else to press where nothing was offered.
    expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss"]);
  });
});
