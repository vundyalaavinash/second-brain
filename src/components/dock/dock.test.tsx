// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { Dock } from "./dock";
import { ToastProvider } from "../shell/toasts";

const push = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => "/inbox", useRouter: () => ({ push }) }));

const ROWS = ["Today", "Inbox, 3 waiting", "Projects", "Areas", "Resources", "People", "Activity", "Library", "Archive", "Search", "Capture"];

/** The two polls the dock inherited from the sidebar. */
function stubFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/inbox")) return Response.json({ count: 3 });
    if (url.startsWith("/api/activity/status")) return Response.json({ helper: { lastSeen: new Date().toISOString() }, paused: false });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** jsdom answers every query with `false`; the dock asks for the narrow layout and for
 * reduced motion, so the stub answers per query string. */
function stubMatchMedia(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: narrow && query.includes("719px"),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }),
  );
}

function mount() {
  render(
    <ToastProvider>
      <Dock />
    </ToastProvider>,
  );
}

function labels(): (string | null)[] {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return Array.from(nav.querySelectorAll("a,button")).map((el) => el.getAttribute("aria-label"));
}

beforeEach(() => {
  stubFetch();
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("Dock", () => {
  it("lays the views out in order and marks the open one", async () => {
    mount();
    await waitFor(() => expect(labels()).toEqual(ROWS));
    expect(screen.getByRole("link", { name: "Inbox, 3 waiting" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Today" }).getAttribute("aria-current")).toBeNull();
  });

  it("counts the inbox into the row's label", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("link", { name: "Inbox, 3 waiting" })).toBeTruthy());
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("opens the bar for the capture shortcut and closes it on escape", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Capture" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Capture" }).getAttribute("aria-expanded")).toBe("false");
    act(() => {
      window.dispatchEvent(new Event("sb:prompt-focus"));
    });
    const field = await screen.findByRole("textbox", { name: "Ask, capture, or add a task" });
    expect(document.activeElement).toBe(field);
    // The bar is the pill's expanded state, so the row of icons is not there beside it.
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    fireEvent.keyDown(field, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Ask, capture, or add a task" })).toBeNull());
    expect(screen.getByRole("button", { name: "Capture" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens the bar when capture is pressed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Capture" }));
    expect(await screen.findByRole("textbox", { name: "Ask, capture, or add a task" })).toBeTruthy();
  });

  it("keeps five items on a narrow screen and puts the rest in the sheet", async () => {
    stubMatchMedia(true);
    mount();
    await waitFor(() => expect(labels()).toEqual(["Today", "Inbox, 3 waiting", "Search", "Capture", "More"]));
    const more = screen.getByRole("button", { name: "More" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const sheet = screen.getByRole("list", { name: "More views" });
    expect(Array.from(sheet.querySelectorAll("a")).map((a) => a.textContent)).toEqual([
      expect.stringContaining("Projects"),
      expect.stringContaining("Areas"),
      expect.stringContaining("Resources"),
      expect.stringContaining("People"),
      expect.stringContaining("Activity"),
      expect.stringContaining("Library"),
      expect.stringContaining("Archive"),
    ]);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("list", { name: "More views" })).toBeNull());
    expect(document.activeElement).toBe(more);
  });
});
