// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, waitFor } from "@testing-library/react";
import type { PlannerDayDTO, TaskDTO, ContainerRefDTO } from "@/lib/dto";
import { SourcesDrawer } from "./sources-drawer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/planner" }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    /* jsdom without storage */
  }
});

const TODAY = "2026-09-23";
let nextId = 1;
function task(over: Partial<TaskDTO> & { title: string }): TaskDTO {
  return {
    id: nextId++, notes: "", status: "open", priority: "normal", dueDate: null, containerId: null, sourceItemId: null,
    completedAt: null, sortOrder: 0, estimateMinutes: null, scheduledAt: null, createdAt: "2026-09-22T09:00:00.000Z", updatedAt: "2026-09-22T09:00:00.000Z", ...over,
  };
}
function container(id: number, kind: "project" | "area", name: string): ContainerRefDTO {
  return { id, kind, name, slug: name.toLowerCase() };
}
const launch = container(10, "project", "Launch");
const health = container(11, "area", "Health");
const loose = task({ title: "Loose one" });
const late = task({ title: "Late one", dueDate: "2026-09-20", containerId: 10 });
const ship = task({ title: "Ship it", containerId: 10 });
const walk = task({ title: "Walk", containerId: 11 });
const planned = task({ title: "Already planned", containerId: 10 });

function day(over: Partial<PlannerDayDTO> = {}): PlannerDayDTO {
  return {
    date: TODAY,
    plan: [{ ...planned, planId: 1 }],
    unfinishedYesterday: [],
    due: { overdue: [late], today: [] },
    meetings: [],
    calendar: { calendarsSeen: 1, permission: true },
    sources: { inbox: [loose], due: { overdue: [late], today: [] }, projects: [{ container: launch, tasks: [late, ship, planned] }], areas: [{ container: health, tasks: [walk] }] },
    capacity: { freeMinutes: 540, plannedMinutes: 0, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0 },
    ...over,
  };
}

function stubPlan() {
  const posts: { url: string; method?: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      posts.push({ url: String(input), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json({});
    }),
  );
  return posts;
}

describe("SourcesDrawer", () => {
  it("opens on Due when something is due, counts each tab, and adds a task to the plan", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Inbox 1", "Due 1", "Projects 2", "Areas 1", "Search"]);
    expect(screen.getByRole("tab", { name: /Due/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Plan Late one for today" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: "/api/plan", method: "POST", body: { date: TODAY, taskId: late.id } }));
  });

  it("dims a planned row and unplans it from its check", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day({ sources: { ...day().sources, due: { overdue: [], today: [] } } })} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const row = screen.getByText("Already planned").closest("li")!;
    expect(row.className).toMatch(/opacity/);
    fireEvent.click(within(row).getByRole("button", { name: "Take Already planned off the plan" }));
    await waitFor(() => expect(posts[0]).toMatchObject({ url: "/api/plan", method: "DELETE", body: { date: TODAY, taskId: planned.id } }));
  });

  it("groups projects with empty ones last and collapsed", () => {
    stubPlan();
    const idle = container(12, "project", "Idle");
    const d = day();
    d.sources.projects = [{ container: idle, tasks: [] }, ...d.sources.projects];
    render(<SourcesDrawer day={d} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const groups = screen.getAllByRole("group");
    expect(groups.map((g) => g.querySelector("summary")?.textContent)).toEqual(["Launch2", "Idle0"]);
    expect((groups[1] as HTMLDetailsElement).open).toBe(false);
  });

  it("searches every open task and groups hits by home", () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: "Search" }));
    expect(screen.getByText("Type to search every open task")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "one" } });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Loose one"), expect.stringContaining("Late one")]));
    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("Launch")).toBeTruthy();
  });

  it("remembers the tab, and switches on the drawer event", async () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Areas/ }));
    cleanup();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: /Areas/ }).getAttribute("aria-selected")).toBe("true"));
    window.dispatchEvent(new CustomEvent("sb:planner-drawer", { detail: { tab: "projects", focus: true } }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Projects/ }).getAttribute("aria-selected")).toBe("true"));
    expect(document.activeElement?.textContent).toContain("Late one");
  });

  // Moved here from the plan pane, which no longer shows a row that is not planned yet.
  it("names the plan after the day on screen, not after today", () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Inbox/ }));
    expect(screen.getByRole("button", { name: "Plan Loose one for today" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(screen.getByRole("menuitem", { name: "Plan for today" })).toBeTruthy();
    cleanup();

    render(<SourcesDrawer day={day({ date: "2026-09-24" })} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Inbox/ }));
    expect(screen.getByRole("button", { name: "Plan Loose one for 2026-09-24" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Task actions" }));
    expect(screen.getByRole("menuitem", { name: "Plan for this day" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Plan for today" })).toBeNull();
  });

  it("takes a plan row dropped on it off the plan", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    const dt = { types: ["application/x-sb-plan"], getData: () => String(planned.id), setData: vi.fn(), effectAllowed: "move", dropEffect: "move" };
    fireEvent.drop(screen.getByRole("complementary", { name: "Sources" }), { dataTransfer: dt });
    await waitFor(() => expect(posts).toEqual([{ url: "/api/plan", method: "DELETE", body: { date: TODAY, taskId: 5 } }]));
  });

  it("plans on Enter and moves focus to the next row", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    fireEvent.click(screen.getByRole("tab", { name: /Projects/ }));
    const first = screen.getByRole("button", { name: "Plan Late one for today" });
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Plan Ship it for today");
  });
  it("plans a task from its row with the keyboard", async () => {
    const posts = stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Late one" }), { key: "p" });
    await waitFor(() => expect(posts).toEqual([{ url: "/api/plan", method: "POST", body: { date: TODAY, taskId: late.id } }]));
  });

  it("moves the selected tab with the arrow keys, taking the focus along", async () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    const tablist = screen.getByRole("tablist", { name: "Sources" });
    const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true");

    expect(selected()?.textContent).toBe("Due 1");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected()?.textContent).toBe("Projects 2");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Projects 2"));

    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(selected()?.textContent).toBe("Inbox 1");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Inbox 1"));
  });

  it("gives the panel behind the tabs a stop of its own", () => {
    stubPlan();
    render(<SourcesDrawer day={day()} today={TODAY} />);
    expect(screen.getByRole("tabpanel").getAttribute("tabindex")).toBe("0");
  });

  it("says there is nothing to plan from instead of five empty tabs", () => {
    stubPlan();
    render(<SourcesDrawer day={day({ sources: { inbox: [], due: { overdue: [], today: [] }, projects: [{ container: launch, tasks: [] }], areas: [] } })} today={TODAY} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Nothing to plan yet. Add tasks from the Inbox or a project.")).toBeTruthy();
  });

  it("opens on the first tab that has work when nothing is due and the inbox is empty", () => {
    stubPlan();
    render(<SourcesDrawer day={day({ sources: { inbox: [], due: { overdue: [], today: [] }, projects: [{ container: launch, tasks: [ship] }], areas: [] } })} today={TODAY} />);
    expect(screen.getByRole("tab", { name: /Projects/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("goes quiet once everything it could offer is already on the plan", () => {
    stubPlan();
    render(<SourcesDrawer day={day({ plan: [{ ...ship, planId: 3 }], sources: { inbox: [], due: { overdue: [], today: [] }, projects: [{ container: launch, tasks: [ship] }], areas: [] } })} today={TODAY} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText(/Nothing to plan yet/)).toBeTruthy();
  });
});
