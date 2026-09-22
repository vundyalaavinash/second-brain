// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { CommandPalette } from "./command-palette";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function stubFetch() {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("kind=project")) return Response.json([{ id: 1, name: "Launch newsletter", slug: "launch-newsletter" }]);
    if (url.includes("kind=area")) return Response.json([{ id: 2, name: "Health", slug: "health" }]);
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
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
    expect(screen.getByText("Today")).toBeTruthy();
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

  it("labels the kind of each jump row", async () => {
    open();
    await waitFor(() => expect(screen.getByText("Launch newsletter")).toBeTruthy());
    expect(screen.getByText("Project")).toBeTruthy();
    expect(screen.getByText("Area")).toBeTruthy();
  });
});
