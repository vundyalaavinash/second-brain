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
function type(text: string) {
  const input = screen.getByRole("textbox", { name: "Ask, capture, or add a task" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("PromptBar", () => {
  it("adds a task in the current container and toasts", async () => {
    const fetchFn = mockFetch({ id: 9, title: "Call the bank" });
    setCurrentContainer(4);
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    type("+ Call the bank");
    await waitFor(() => expect(screen.getByText("Task added")).toBeTruthy());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Call the bank", containerId: 4 });
  });

  it("captures a note to the inbox", async () => {
    const fetchFn = mockFetch({ id: 12, type: "note", title: "Remember" });
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    type("Remember the milk");
    await waitFor(() => expect(screen.getByText("Captured to Inbox")).toBeTruthy());
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/api/items");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/items/12");
  });

  it("navigates for search", () => {
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    type("?tax");
    expect(push).toHaveBeenCalledWith("/search?q=tax");
  });

  it("shows the server error and keeps the text", async () => {
    mockFetch({ error: "Body required" }, 400);
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    type("x");
    await waitFor(() => expect(screen.getByText("Body required")).toBeTruthy());
    expect((screen.getByRole("textbox", { name: "Ask, capture, or add a task" }) as HTMLInputElement).value).toBe("x");
  });

  it("refuses a task with no title", async () => {
    const fetchFn = mockFetch({ id: 1 });
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    type("+");
    await waitFor(() => expect(screen.getByText("Add a task title")).toBeTruthy());
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("opens the prompt menu on a leading slash and inserts the chosen word", () => {
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Ask, capture, or add a task" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/" } });
    expect(screen.getByRole("listbox", { name: "Prompt commands" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Task/ }));
    expect(input.value).toBe("/task ");
    expect(screen.queryByRole("listbox", { name: "Prompt commands" })).toBeNull();
  });

  it("focuses the input on c, but not while typing", () => {
    render(
      <ToastProvider>
        <PromptBar />
      </ToastProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Ask, capture, or add a task" });
    fireEvent.keyDown(window, { key: "c" });
    expect(document.activeElement).toBe(input);
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "c" });
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});
