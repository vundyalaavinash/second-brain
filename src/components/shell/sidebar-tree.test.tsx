// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SidebarTree } from "./sidebar-tree";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const containers = [
  { id: 1, kind: "project", name: "Launch newsletter", slug: "launch-newsletter", progress: { percent: 40, open: 3, done: 2, total: 5, nextTask: null } },
];

describe("SidebarTree", () => {
  it("opens, lists containers, and persists the open state", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(containers), { headers: { "content-type": "application/json" } })));
    render(<SidebarTree kind="project" label="Projects" pathname="/projects" />);
    fireEvent.click(screen.getByRole("button", { name: "Show projects" }));
    await waitFor(() => expect(screen.getByText("Launch newsletter")).toBeTruthy());
    expect(JSON.parse(localStorage.getItem("sb.sidebar.open") ?? "{}")).toEqual({ project: true });
    vi.unstubAllGlobals();
  });
});
