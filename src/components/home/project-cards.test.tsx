// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { ProjectCards } from "./project-cards";
import type { ProjectCardDTO } from "@/lib/dto";

const TODAY = "2026-09-22";

const card = (over: Partial<ProjectCardDTO> = {}): ProjectCardDTO => ({
  id: 1,
  name: "Launch",
  slug: "launch",
  open: 3,
  done: 1,
  nextTask: { id: 5, title: "Write the brief" },
  deadline: null,
  updatedAt: "2026-09-21T09:00:00.000Z",
  ...over,
});

/** The tone class the card's deadline is set in. */
function deadlineTone(text: string): string {
  return screen.getByText(text).className;
}

afterEach(cleanup);

describe("ProjectCards", () => {
  it("names the project, its open tasks with the progress figure, and what comes next", () => {
    render(<ProjectCards projects={[card()]} today={TODAY} />);
    const item = screen.getByRole("listitem");
    expect(within(item).getByRole("link", { name: "Launch" }).getAttribute("href")).toBe("/c/launch");
    expect(item.textContent).toContain("3 open");
    expect(item.textContent).toContain("25%");
    expect(item.textContent).toContain("Write the brief");
  });

  it("says so rather than showing a blank line when a project has no open task left", () => {
    render(<ProjectCards projects={[card({ open: 0, done: 4, nextTask: null })]} today={TODAY} />);
    expect(screen.getByText("All done")).toBeTruthy();
  });

  it("does not call a project nobody has written a task for finished", () => {
    render(<ProjectCards projects={[card({ open: 0, done: 0, nextTask: null })]} today={TODAY} />);
    expect(screen.getByText("No open tasks")).toBeTruthy();
    expect(screen.queryByText("All done")).toBeNull();
  });

  it("warns inside a week and turns danger once the deadline is past", () => {
    render(
      <ProjectCards
        projects={[
          card({ id: 1, name: "Soon", slug: "soon", deadline: "2026-09-26" }),
          card({ id: 2, name: "Late", slug: "late", deadline: "2026-09-20" }),
          card({ id: 3, name: "Far", slug: "far", deadline: "2026-11-01" }),
        ]}
        today={TODAY}
      />,
    );
    expect(deadlineTone("26 Sep")).toContain("text-warn");
    expect(deadlineTone("20 Sep")).toContain("text-danger");
    expect(deadlineTone("1 Nov")).toContain("text-fg-muted");
  });

  it("leaves the deadline off a project that has none, and links to all of them", () => {
    render(<ProjectCards projects={[card()]} today={TODAY} />);
    expect(screen.queryByText("No deadline")).toBeNull();
    expect(screen.getByRole("link", { name: "All projects" }).getAttribute("href")).toBe("/projects");
  });

  it("says the shelf is empty in one line", () => {
    render(<ProjectCards projects={[]} today={TODAY} />);
    expect(screen.getByText("No active projects")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
