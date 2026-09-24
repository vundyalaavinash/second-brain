// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CapacityLine } from "./capacity-line";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = { freeMinutes: 270, plannedMinutes: 130, unestimated: 0, workHours: "09:00-18:00", blockedMinutes: 0, unplacedMinutes: 0 };

describe("CapacityLine", () => {
  it("reads planned against free with the meeting count", () => {
    render(<CapacityLine capacity={base} planned={3} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("3 planned · 2h 10m of 4h 30m free · 4 meetings");
  });

  it("says how much of the plan has a place on the timeline", () => {
    render(<CapacityLine capacity={{ ...base, blockedMinutes: 80 }} planned={3} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("3 planned \u00b7 2h 10m of 4h 30m free \u00b7 1h 20m blocked \u00b7 4 meetings");
  });

  it("says how much the day had no room for, after the blocked figure", () => {
    render(<CapacityLine capacity={{ ...base, blockedMinutes: 80, unplacedMinutes: 80 }} planned={3} meetings={1} onHours={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("3 planned \u00b7 2h 10m of 4h 30m free \u00b7 1h 20m blocked \u00b7 1h 20m unplaced \u00b7 1 meeting");
  });

  it("names the unestimated and warns past the free time", () => {
    render(<CapacityLine capacity={{ ...base, plannedMinutes: 300, unestimated: 2 }} planned={5} meetings={1} onHours={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("(2 unestimated)");
    expect(status.querySelector(".text-warn")).toBeTruthy();
    expect(status.getAttribute("title")).toBe("Plan is 30m over the free time");
    // Colour alone never carries it: the phrase is in the status for a reader that sees neither.
    expect(status.querySelector(".sr-only")?.textContent).toBe(". Plan is 30m over the free time");
  });

  it("says nothing extra while the plan fits", () => {
    render(<CapacityLine capacity={base} planned={3} meetings={0} onHours={vi.fn()} />);
    expect(screen.getByRole("status").querySelector(".sr-only")).toBeNull();
  });

  it("names the hours panel as the dialog the chip promises", () => {
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Working hours" })).toBeTruthy();
  });

  it("goes to danger past a quarter over", () => {
    render(<CapacityLine capacity={{ ...base, plannedMinutes: 400 }} planned={5} meetings={1} onHours={vi.fn()} />);
    expect(screen.getByRole("status").querySelector(".text-danger")).toBeTruthy();
  });

  it("closes without saving when the trigger is clicked again", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={onHours} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Working hours" })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("textbox", { name: "Working hours" })).toBeNull();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("saves a changed value once when the click lands outside, and drops a bad one", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Working hours" }), { target: { value: "08:30-17:00" } });
    fireEvent.mouseDown(document.body);
    expect(onHours).toHaveBeenCalledTimes(1);
    expect(onHours).toHaveBeenCalledWith("08:30-17:00");

    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Working hours" }), { target: { value: "nonsense" } });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("textbox", { name: "Working hours" })).toBeNull();
    expect(onHours).toHaveBeenCalledTimes(1);
  });

  it("complains about a range Enter cannot make sense of", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "18:00-09:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Use HH:MM-HH:MM, start before end")).toBeTruthy();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("edits the hours from the chip", async () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={base} planned={0} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "08:30-17:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onHours).toHaveBeenCalledWith("08:30-17:00"));
  });
});
