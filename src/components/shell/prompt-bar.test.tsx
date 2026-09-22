// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PromptBar } from "./prompt-bar";
import { ToastProvider } from "./toasts";
import { setCurrentContainer } from "@/lib/current-container";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/inbox" }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCurrentContainer(null);
  push.mockClear();
});

function mockFetch(body: unknown, status = 201) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mount() {
  render(
    <ToastProvider>
      <PromptBar />
    </ToastProvider>,
  );
}

function field(): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Ask, capture, or add a task" }) as HTMLInputElement | HTMLTextAreaElement;
}

function type(text: string) {
  const input = field();
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("PromptBar", () => {
  it("adds a task in the current container and toasts", async () => {
    const fetchFn = mockFetch({ id: 9, title: "Call the bank" });
    setCurrentContainer({ id: 4, name: "Health" });
    mount();
    type("+ Call the bank");
    await waitFor(() => expect(screen.getByText("Task added")).toBeTruthy());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Call the bank", containerId: 4 });
  });

  it("captures a note to the inbox", async () => {
    const fetchFn = mockFetch({ id: 12, type: "note", title: "Remember" });
    mount();
    type("Remember the milk");
    await waitFor(() => expect(screen.getByText("Captured to Inbox")).toBeTruthy());
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/api/items");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/items/12");
  });

  it("captures a note into the open container and says where it went", async () => {
    const fetchFn = mockFetch({ id: 13, type: "note", title: "Remember" });
    setCurrentContainer({ id: 4, name: "Health" });
    mount();
    type("Remember the milk");
    await waitFor(() => expect(screen.getByText("Captured to Health")).toBeTruthy());
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ type: "note", containerId: 4 });
  });

  it("names the already captured link and leaves the inbox alone", async () => {
    mockFetch({ existingId: 7 }, 409);
    const changed = vi.fn();
    window.addEventListener("sb:inbox-changed", changed);
    mount();
    type("https://example.com/x");
    await waitFor(() => expect(screen.getByText("Already captured")).toBeTruthy());
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/items/7");
    expect(changed).not.toHaveBeenCalled();
    window.removeEventListener("sb:inbox-changed", changed);
  });

  it("navigates for search", () => {
    mount();
    type("?tax");
    expect(push).toHaveBeenCalledWith("/search?q=tax");
  });

  it("shows the server error and keeps the text", async () => {
    mockFetch({ error: "Body required" }, 400);
    mount();
    type("x");
    await waitFor(() => expect(screen.getByText("Body required")).toBeTruthy());
    expect((field() as HTMLInputElement).value).toBe("x");
  });

  it("refuses a task with no title", async () => {
    const fetchFn = mockFetch({ id: 1 });
    mount();
    type("+");
    await waitFor(() => expect(screen.getByText("Add a task title")).toBeTruthy());
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("asks for the missing half of a bare command word", async () => {
    const fetchFn = mockFetch({ id: 1 });
    mount();
    type("?");
    await waitFor(() => expect(screen.getByText("Type something to search")).toBeTruthy());
    // With a trailing space the slash menu is closed, so Enter reaches submit.
    type("/note ");
    await waitFor(() => expect(screen.getByText("Type a note")).toBeTruthy());
    expect(fetchFn).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("opens the prompt menu on a leading slash and inserts the chosen word", () => {
    mount();
    const input = field();
    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: "Prompt commands" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(4);
    fireEvent.click(screen.getByRole("option", { name: /Task/ }));
    expect((input as HTMLInputElement).value).toBe("/task ");
    expect(screen.queryByRole("listbox", { name: "Prompt commands" })).toBeNull();
  });

  it("filters the menu by what is typed and closes when nothing matches", () => {
    mount();
    const input = field();
    fireEvent.change(input, { target: { value: "/t" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Task")]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("/task ");
    fireEvent.change(input, { target: { value: "/zz" } });
    expect(screen.queryByRole("listbox", { name: "Prompt commands" })).toBeNull();
  });

  // The refocus effect below runs on mount as well as on a real single-line/box swap, so a
  // guard that only remembers "has run" would take focus off whatever the page put it on.
  it("leaves focus alone on mount", () => {
    const before = document.activeElement;
    mount();
    expect(document.activeElement).not.toBe(field());
    expect(document.activeElement).toBe(before);
  });

  it("keeps the caret in the field when shift+enter grows it into a box", async () => {
    const fetchFn = mockFetch({ id: 30, type: "note", title: "Two lines" });
    mount();
    const input = field();
    fireEvent.change(input, { target: { value: "first" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    const box = field();
    expect(box.tagName).toBe("TEXTAREA");
    expect(document.activeElement).toBe(box);
    expect(box.selectionStart).toBe("first".length);
    fireEvent.change(box, { target: { value: "first\nsecond" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Captured to Inbox")).toBeTruthy());
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ body: "first\nsecond" });
  });

  it("focuses the field when the shortcut layer asks for it", () => {
    mount();
    window.dispatchEvent(new Event("sb:prompt-focus"));
    expect(document.activeElement).toBe(field());
  });
});
