// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PromptBar } from "./prompt-bar";
import { ToastProvider } from "./toasts";
import { setCurrentContainer } from "@/lib/current-container";
import { setPlanDate } from "@/lib/plan-date";
import { todayLocal } from "@/components/activity/format";

const push = vi.fn();
const onClose = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/inbox" }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setCurrentContainer(null);
  setPlanDate(null);
  push.mockClear();
  onClose.mockClear();
});

function mockFetch(body: unknown, status = 201) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mount() {
  render(
    <ToastProvider>
      <PromptBar open onClose={onClose} />
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
    type("+ Call the bank ~25m");
    await waitFor(() => expect(screen.getByText("Task added")).toBeTruthy());
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/tasks");
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Call the bank", containerId: 4, estimateMinutes: 25 });
  });

  it("posts a session length from ~2h/45m", async () => {
    const fetchFn = mockFetch({ id: 9, title: "Deep work" });
    mount();
    type("+ Deep work ~2h/45m");
    await waitFor(() => expect(screen.getByText("Task added")).toBeTruthy());
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ title: "Deep work", estimateMinutes: 120, sessionMinutes: 45 });
  });

  it("plans the new task for the day the planner is showing", async () => {
    const fetchFn = mockFetch({ id: 9, title: "Call the bank" });
    const changed = vi.fn();
    window.addEventListener("sb:plan-changed", changed);
    setPlanDate("2026-09-22");
    mount();
    type("+ Call the bank");
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    const [url, init] = fetchFn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("/api/plan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ date: "2026-09-22", taskId: 9 });
    expect(changed).toHaveBeenCalledTimes(1);
    window.removeEventListener("sb:plan-changed", changed);
  });

  it("names today's plan in the toast, or just says the task was planned", async () => {
    mockFetch({ id: 9, title: "Call the bank" });
    setPlanDate(todayLocal());
    mount();
    type("+ Call the bank");
    await waitFor(() => expect(screen.getByText("Task added to today's plan")).toBeTruthy());
    cleanup();
    setPlanDate("2027-03-04");
    mount();
    type("+ Call the vet");
    await waitFor(() => expect(screen.getByText("Task added and planned")).toBeTruthy());
  });

  it("keeps the task and shows the error when the plan write fails", async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url === "/api/plan"
        ? new Response(JSON.stringify({ error: "Could not plan that" }), { status: 400, headers: { "content-type": "application/json" } })
        : new Response(JSON.stringify({ id: 9, title: "Call the bank" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchFn);
    setPlanDate("2027-03-04");
    mount();
    type("+ Call the bank");
    await waitFor(() => expect(screen.getByText("Could not plan that")).toBeTruthy());
    expect(screen.getByText("Task added")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("captures a note to the inbox", async () => {
    const fetchFn = mockFetch({ id: 12, type: "note", title: "Remember" });
    mount();
    type("Remember the milk");
    await waitFor(() => expect(screen.getByText("Captured to Inbox")).toBeTruthy());
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("/api/items");
    expect(screen.getByRole("link", { name: "Open" }).getAttribute("href")).toBe("/items/12");
  });

  it("hands the dock back its pill once the capture lands", async () => {
    mockFetch({ id: 14, type: "note", title: "Remember" });
    mount();
    type("Remember the milk");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
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

  it("reads the estimate back in the task chip", () => {
    mount();
    const input = field();
    fireEvent.change(input, { target: { value: "+ Write ~25m" } });
    const estimate = screen.getByText("~25m");
    expect(estimate.parentElement?.textContent).toBe("Task~25m");
    fireEvent.change(input, { target: { value: "+ Write" } });
    expect(screen.queryByText("~25m")).toBeNull();
  });

  it("reads the session length back in the task chip as ~2h · 45m sessions", () => {
    mount();
    const input = field();
    fireEvent.change(input, { target: { value: "+ Deep work ~2h/45m" } });
    expect(screen.getByText("~2h · 45m sessions")).toBeTruthy();
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

  it("starts from the draft the dock kept and reports every change back to it", () => {
    const onDraftChange = vi.fn();
    render(
      <ToastProvider>
        <PromptBar open onClose={onClose} initialValue="buy mil" onDraftChange={onDraftChange} />
      </ToastProvider>,
    );
    expect((field() as HTMLInputElement).value).toBe("buy mil");
    fireEvent.change(field(), { target: { value: "buy milk" } });
    expect(onDraftChange).toHaveBeenCalledWith("buy milk");
  });

  it("closes on escape whether or not something is typed", () => {
    mount();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.change(field(), { target: { value: "half typed" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("focuses the field when the shortcut layer asks for it", () => {
    mount();
    window.dispatchEvent(new Event("sb:prompt-focus"));
    expect(document.activeElement).toBe(field());
  });
});
