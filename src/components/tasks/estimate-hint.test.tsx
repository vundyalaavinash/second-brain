// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EstimateHint, hasEstimateHint } from "./estimate-hint";

afterEach(cleanup);

describe("EstimateHint", () => {
  it("renders nothing on an open task that already has an estimate", () => {
    const { container } = render(<EstimateHint status="open" estimateMinutes={45} likeThisMinutes={50} onEstimate={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing on a done task", () => {
    const { container } = render(<EstimateHint status="done" estimateMinutes={null} likeThisMinutes={50} onEstimate={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing on a dropped task", () => {
    const { container } = render(<EstimateHint status="dropped" estimateMinutes={null} likeThisMinutes={50} onEstimate={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("renders nothing when there are fewer than three matches to hint from", () => {
    const { container } = render(<EstimateHint status="open" estimateMinutes={null} likeThisMinutes={null} onEstimate={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("offers the figure and a button that sets it, on an open task with no estimate and enough matches", () => {
    const onEstimate = vi.fn();
    render(<EstimateHint status="open" estimateMinutes={null} likeThisMinutes={50} onEstimate={onEstimate} />);
    expect(screen.getByText("Tasks like this have taken about 50m")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use 50m as the estimate" }));
    expect(onEstimate).toHaveBeenCalledWith(50);
  });

  it("formats an hour-plus figure the same way the rest of the app does", () => {
    render(<EstimateHint status="open" estimateMinutes={null} likeThisMinutes={95} onEstimate={vi.fn()} />);
    expect(screen.getByText("Tasks like this have taken about 1h 35m")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use 1h 35m as the estimate" })).toBeTruthy();
  });
});

describe("hasEstimateHint", () => {
  it("agrees with the component on every combination that renders nothing", () => {
    expect(hasEstimateHint({ status: "open", estimateMinutes: 45, likeThisMinutes: 50 })).toBe(false);
    expect(hasEstimateHint({ status: "done", estimateMinutes: null, likeThisMinutes: 50 })).toBe(false);
    expect(hasEstimateHint({ status: "dropped", estimateMinutes: null, likeThisMinutes: 50 })).toBe(false);
    expect(hasEstimateHint({ status: "open", estimateMinutes: null, likeThisMinutes: null })).toBe(false);
  });

  it("is true exactly where the component has something to show", () => {
    expect(hasEstimateHint({ status: "open", estimateMinutes: null, likeThisMinutes: 50 })).toBe(true);
  });
});
