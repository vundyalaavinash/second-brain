// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within, waitFor } from "@testing-library/react";
import type { PlannerDayDTO, TaskDTO } from "@/lib/dto";
import { DayView } from "./day-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/planner" }));

const TODAY = "2026-09-23";

const loose: TaskDTO = {
  id: 1, title: "Loose one", notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
  estimateMinutes: null, completedAt: null, sortOrder: 0, createdAt: "", updatedAt: "",
};

function day(): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [],
    unfinishedYesterday: [],
    due: { overdue: [], today: [] },
    meetings: [],
    calendar: { calendarsSeen: 1, permission: true },
    sources: { inbox: [loose], due: { overdue: [], today: [] }, projects: [], areas: [] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00" },
  };
}

function mount() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => (String(input) === "/api/meetings/recorder" ? Response.json({ state: "idle", missing: [] }) : Response.json({}))),
  );
  render(<DayView day={day()} today={TODAY} onRefresh={vi.fn()} />);
}

const overlay = () => screen.queryByRole("dialog", { name: "Sources" });

function drawer(): void {
  act(() => {
    fireEvent.keyDown(window, { key: "/", metaKey: true });
  });
}

/** jsdom has no layout: the tests say which width the page is at. */
function atWidth(floating: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: floating && query.includes("1100px"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

describe("DayView", () => {
  it("keeps the sources off the page until asked, then slides them over the plan from the button", () => {
    atWidth(true);
    mount();
    expect(overlay()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add tasks" }));
    expect(overlay()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide sources" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide sources" }));
    expect(overlay()).toBeNull();
  });

  it("remembers a slide-over left open", async () => {
    atWidth(true);
    mount();
    drawer();
    expect(overlay()).toBeTruthy();
    cleanup();
    atWidth(true);
    mount();
    await waitFor(() => expect(overlay()).toBeTruthy());
  });

  it("writes the plan first, then the timeline, then the sources", () => {
    atWidth(false);
    mount();
    const plan = screen.getByRole("list", { name: "Plan" });
    const timeline = screen.getByRole("region", { name: "Timeline" });
    const sources = screen.getByRole("complementary", { name: "Sources" });
    // Tab order is document order: the day's own work comes before the calendar beside it.
    expect(plan.compareDocumentPosition(timeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(timeline.compareDocumentPosition(sources) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("moves into the stacked sources with the drawer key on a narrow screen", () => {
    atWidth(false);
    mount();
    drawer();
    // Nothing floats at this width, so the key opens the section and hands over the keyboard.
    expect(overlay()).toBeNull();
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  });

  it("opens and closes the sources over the plan with the drawer key", () => {
    atWidth(true);
    mount();
    expect(overlay()).toBeNull();
    drawer();
    expect(overlay()).toBeTruthy();
    expect(within(overlay()!).getByRole("tab", { name: /Inbox/ })).toBeTruthy();
    drawer();
    expect(overlay()).toBeNull();
  });

  it("gives the keyboard to the open drawer's own tab", () => {
    atWidth(true);
    mount();
    drawer();
    expect(document.activeElement?.getAttribute("role")).toBe("tab");
    expect(document.activeElement?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes on Escape, but not while something inside is being typed in", () => {
    atWidth(true);
    mount();
    drawer();
    fireEvent.click(within(overlay()!).getByRole("tab", { name: "Search" }));
    fireEvent.keyDown(within(overlay()!).getByRole("searchbox"), { key: "Escape" });
    expect(overlay()).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlay()).toBeNull();
  });

  it("answers the drawer event: toggling, and opening on a named tab", () => {
    atWidth(true);
    mount();
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { toggle: true } }));
    });
    expect(overlay()).toBeTruthy();
    act(() => {
      window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { toggle: true } }));
    });
    expect(overlay()).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects" } }));
    });
    expect(overlay()).toBeTruthy();
    expect(within(overlay()!).getByRole("tab", { name: /Projects/ }).getAttribute("aria-selected")).toBe("true");
  });
});
