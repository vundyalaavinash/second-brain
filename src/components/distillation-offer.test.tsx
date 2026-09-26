// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DistillationOffer } from "./distillation-offer";

afterEach(cleanup);

describe("DistillationOffer", () => {
  it("renders nothing when there is no distillation", () => {
    const { container } = render(<DistillationOffer distillation={undefined} onKeep={vi.fn()} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once dismissed", () => {
    const { container } = render(
      <DistillationOffer
        distillation={{ gist: "g", quotes: ["a"], generatedAt: "now", status: "dismissed" }}
        onKeep={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the gist, the quotes, and both buttons while pending", () => {
    render(
      <DistillationOffer
        distillation={{ gist: "A short paragraph.", quotes: ["First quote", "Second quote"], generatedAt: "now", status: "pending" }}
        onKeep={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("A short paragraph.")).toBeTruthy();
    expect(screen.getByText("First quote")).toBeTruthy();
    expect(screen.getByRole("button", { name: /keep/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /not useful/i })).toBeTruthy();
  });

  it("calls onKeep when Keep is clicked", () => {
    const onKeep = vi.fn();
    render(
      <DistillationOffer
        distillation={{ gist: "g", quotes: ["a", "b"], generatedAt: "now", status: "pending" }}
        onKeep={onKeep}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /keep/i }));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it("once kept, shows the gist and quotes with no buttons at all", () => {
    render(
      <DistillationOffer
        distillation={{ gist: "A short paragraph.", quotes: ["First quote"], generatedAt: "now", status: "kept" }}
        onKeep={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText("A short paragraph.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /keep/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /not useful/i })).toBeNull();
  });
});
