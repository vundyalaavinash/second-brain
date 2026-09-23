// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
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
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
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
  it("is a plain column on a wide screen, whatever the drawer key does", () => {
    atWidth(false);
    mount();
    drawer();
    expect(overlay()).toBeNull();
    expect(screen.getByRole("tab", { name: /Inbox/ })).toBeTruthy();
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
