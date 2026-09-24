// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { GoalPage } from "./goal-page";
import type { GoalDetailDTO } from "@/lib/dto";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, refresh: () => {} }) }));

const TODAY = "2026-09-24";

function detail(over: Partial<GoalDetailDTO> = {}): GoalDetailDTO {
  const container = { id: 9, name: "API v2", slug: "api-v2", kind: "project" as const };
  return {
    id: 1, title: "Launch v2", outcome: "Customers are on the new API", horizon: "quarter",
    targetDate: "2026-12-31", status: "active", notes: "", sortOrder: 0, closedAt: null,
    measure: { open: 3, done: 7, total: 10, percent: 70, movement: 2, lastClosedAt: null, stalled: false },
    containers: [container],
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    links: [{ container, progress: { open: 3, done: 7, total: 10, percent: 70, nextTask: null } }],
    recentCloses: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
});

describe("GoalPage — delete", () => {
  it("opens a real confirmation naming the goal and what its links lose, rather than a second click on the icon", () => {
    render(<GoalPage initial={detail()} today={TODAY} />);
    const trigger = screen.getByRole("button", { name: "Delete goal" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /Launch v2/ });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText(/1 link/)).toBeTruthy();
    // The trigger never changes its own label/colour as a stand-in for confirmation.
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
  });

  it("cancelling the dialog deletes nothing and returns focus to the trigger", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<GoalPage initial={detail()} today={TODAY} />);
    const trigger = screen.getByRole("button", { name: "Delete goal" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("confirming deletes the goal and goes back to the goals list", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/goals/1" && init?.method === "DELETE") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<GoalPage initial={detail()} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete goal" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/goals"));
    expect(fetchMock).toHaveBeenCalledWith("/api/goals/1", expect.objectContaining({ method: "DELETE" }));
  });

  it("a second click on the confirm button while the delete is in flight sends only one request", async () => {
    const gates: (() => void)[] = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => gates.push(() => resolve(new Response(null, { status: 204 })))));
    vi.stubGlobal("fetch", fetchMock);
    render(<GoalPage initial={detail()} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete goal" }));
    const confirm = screen.getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gates[0]();
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/goals"));
  });
});

describe("GoalPage — reopen", () => {
  it("guards a double click against sending two requests", async () => {
    const gates: (() => void)[] = [];
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => gates.push(() => resolve(Response.json({ ...detail(), status: "active", closedAt: null })))),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<GoalPage initial={detail({ status: "hit", closedAt: "2026-09-20T10:00:00.000Z" })} today={TODAY} />);
    const button = screen.getByRole("button", { name: "Reopen" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gates[0]();
    // The single in-flight PATCH lands and flips the goal back to active, which swaps the
    // Reopen button out for Close — proof only one request was ever honoured.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull());
  });
});
