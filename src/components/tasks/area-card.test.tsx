// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AreaCard } from "./area-card";
import type { ContainerDTO } from "@/lib/dto";

const NOW = Date.parse("2026-09-26T12:00:00.000Z");

function area(over: Partial<ContainerDTO> = {}): ContainerDTO {
  return {
    id: 1,
    kind: "area",
    name: "Health",
    slug: "health",
    description: "",
    status: "active",
    goal: "",
    deadline: null,
    standard: "Move every day",
    category: null,
    sortOrder: 0,
    archivedAt: null,
    itemCount: 4,
    totalItemCount: 4,
    progress: { open: 1, done: 3, total: 4, percent: 75, nextTask: { id: 9, title: "Book the physio", dueDate: null } },
    pinnedLinks: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-26T09:00:00.000Z",
    ...over,
  };
}

describe("AreaCard", () => {
  it("names the standard, the progress and the next thing to do, all leading to the area", () => {
    render(<AreaCard area={area()} now={NOW} />);
    const link = screen.getByRole("link", { name: /Health/ });
    expect(link.getAttribute("href")).toBe("/c/health");
    expect(screen.getByText("Move every day")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Book the physio")).toBeTruthy();
    expect(screen.getByText("4 tasks, 4 items")).toBeTruthy();
    expect(screen.getByText("Updated 3 h ago")).toBeTruthy();
  });

  it("says nothing is open rather than naming a task that does not exist", () => {
    render(<AreaCard area={area({ progress: { open: 0, done: 4, total: 4, percent: 100, nextTask: null } })} now={NOW} />);
    expect(screen.getByText("All done")).toBeTruthy();
  });

  it("says there are no open tasks yet, for an area nobody has written one for", () => {
    render(<AreaCard area={area({ progress: { open: 0, done: 0, total: 0, percent: 0, nextTask: null } })} now={NOW} />);
    expect(screen.getByText("No open tasks")).toBeTruthy();
  });
});
