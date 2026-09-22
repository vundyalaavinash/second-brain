// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { Sidebar } from "./sidebar";

// jsdom has no navigation, so following a row's href logs "Not implemented"; the row's own
// onClick has already run by the time this cancels the default action.
const stopNavigation = (e: MouseEvent) => e.preventDefault();

beforeEach(() => {
  localStorage.clear();
  document.addEventListener("click", stopNavigation);
});
afterEach(() => {
  document.removeEventListener("click", stopNavigation);
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

/** The sidebar polls the inbox and the activity helper as soon as it mounts. */
function stubFetch(inboxCount: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/inbox")) return json({ count: inboxCount });
      if (url.startsWith("/api/activity/status")) {
        return json({ helper: { lastSeen: new Date().toISOString(), version: null, permissions: null }, paused: false });
      }
      return json([]);
    }),
  );
}

describe("Sidebar", () => {
  it("closes the drawer when a row is followed, so the overlay does not sit over the new page", () => {
    stubFetch(0);
    const onClose = vi.fn();
    render(<Sidebar drawer onClose={onClose} pathname="/inbox" />);
    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves a row click alone when the sidebar is a column rather than a drawer", () => {
    stubFetch(0);
    const onClose = vi.fn();
    render(<Sidebar drawer={false} onClose={onClose} pathname="/inbox" />);
    fireEvent.click(screen.getByRole("link", { name: "Library" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the open drawer on Escape", () => {
    stubFetch(0);
    const onClose = vi.fn();
    render(<Sidebar drawer onClose={onClose} pathname="/inbox" />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("folds the waiting count into the inbox row's label", async () => {
    stubFetch(3);
    render(<Sidebar drawer={false} onClose={vi.fn()} pathname="/today" />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Inbox, 3 waiting" })).toBeTruthy());
  });
});
