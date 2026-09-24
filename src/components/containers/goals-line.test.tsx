// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GoalsLine } from "./goals-line";
import type { GoalRefDTO } from "@/lib/dto";

afterEach(cleanup);

describe("GoalsLine", () => {
  it("names each goal it serves, as a link to the goal", () => {
    const goals: GoalRefDTO[] = [
      { id: 1, title: "Launch v2" },
      { id: 2, title: "Ship the API" },
    ];
    render(<GoalsLine goals={goals} />);
    expect(screen.getByText(/serves/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Launch v2" }).getAttribute("href")).toBe("/goals/1");
    expect(screen.getByRole("link", { name: "Ship the API" }).getAttribute("href")).toBe("/goals/2");
  });

  it("renders nothing at all when the container serves no goal", () => {
    const { container } = render(<GoalsLine goals={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
