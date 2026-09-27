// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ResourceCard } from "./resource-card";
import type { ContainerDTO } from "@/lib/dto";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");

afterEach(cleanup);

function resource(over: Partial<ContainerDTO> = {}): ContainerDTO {
  return {
    id: 1,
    kind: "resource",
    name: "Type theory",
    slug: "type-theory",
    description: "",
    status: "active",
    goal: "",
    deadline: null,
    standard: "",
    nextSteps: "",
    category: "reference",
    sortOrder: 0,
    archivedAt: null,
    itemCount: 6,
    totalItemCount: 6,
    progress: { open: 0, done: 0, total: 0, percent: 0, nextTask: null },
    pinnedLinks: [{ id: 1, title: "TAPL", url: "https://example.com/tapl", domain: "example.com" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-27T09:00:00.000Z",
    ...over,
  };
}

describe("ResourceCard", () => {
  it("leads with the category and the pinned links, all leading to the resource", () => {
    render(<ResourceCard resource={resource()} now={NOW} />);
    const link = screen.getByRole("link", { name: /Type theory/ });
    expect(link.getAttribute("href")).toBe("/c/type-theory");
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.getByText("Updated 3 h ago")).toBeTruthy();
    expect(screen.getByText("6 items")).toBeTruthy();
  });

  it("says nothing is pinned yet, rather than an empty row", () => {
    render(<ResourceCard resource={resource({ pinnedLinks: [] })} now={NOW} />);
    expect(screen.getByText("No links pinned yet")).toBeTruthy();
  });

  it("names an open task only when one actually exists, since a resource rarely has any", () => {
    render(<ResourceCard resource={resource()} now={NOW} />);
    expect(screen.queryByText(/open task/)).toBeNull();
    render(<ResourceCard resource={resource({ id: 2, slug: "other", progress: { open: 2, done: 0, total: 2, percent: 0, nextTask: null } })} now={NOW} />);
    expect(screen.getByText("2 open tasks, 6 items")).toBeTruthy();
  });
});
