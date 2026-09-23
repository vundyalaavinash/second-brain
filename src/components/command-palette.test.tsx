// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { CommandPalette } from "./command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/** Answers everything the palette asks for on opening, and records what it posts. */
function stubWith(extra: { tasks?: unknown[] } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return Response.json({});
    }
    if (url.includes("kind=project")) return Response.json([{ id: 1, name: "Launch newsletter", slug: "launch-newsletter" }]);
    if (url.includes("kind=area")) return Response.json([{ id: 2, name: "Health", slug: "health" }]);
    if (url.startsWith("/api/tasks")) return Response.json({ tasks: extra.tasks ?? [] });
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return posts;
}

function stubFetch() {
  stubWith();
}

function open() {
  render(<CommandPalette />);
  act(() => {
    window.dispatchEvent(new Event("sb:palette"));
  });
  return screen.getByPlaceholderText("Jump to a view or run a command");
}

beforeEach(stubFetch);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("CommandPalette", () => {
  it("lists the views", () => {
    open();
    expect(screen.getByText("Planner")).toBeTruthy();
    expect(screen.getByText("Archive")).toBeTruthy();
  });

  it("jumps to an active project by name", async () => {
    const input = open();
    await waitFor(() => expect(screen.getByText("Launch newsletter")).toBeTruthy());
    fireEvent.change(input, { target: { value: "launch" } });
    expect(screen.getByText("Launch newsletter")).toBeTruthy();
    expect(screen.queryByText("Health")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/c/launch-newsletter");
  });

  it("offers to plan a matching open task once two characters are typed", async () => {
    const posts = stubWith({ tasks: [{ id: 5, title: "Write the release note", status: "open" }] });
    open();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "w" } });
    expect(screen.queryByText("Plan")).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "wr" } });
    const item = await screen.findByText("Write the release note");
    expect(screen.getByText("Plan")).toBeTruthy();
    fireEvent.click(item);
    await waitFor(() => expect(posts.find((p) => p.url === "/api/plan")?.body).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), taskId: 5 }));
  });

  it("labels the kind of each jump row", async () => {
    open();
    await waitFor(() => expect(screen.getByText("Launch newsletter")).toBeTruthy());
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("Area")).toBeTruthy();
  });
});
