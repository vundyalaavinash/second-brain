// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { CapacityLine } from "./capacity-line";
import type { CapacityDTO } from "@/lib/dto";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: CapacityDTO = {
  freeMinutes: 310,
  plannedMinutes: 270,
  unestimated: 0,
  workHours: "09:00-18:00",
  blockedMinutes: 0,
  unplacedMinutes: 0,
  drift: 1.63,
  forecastMinutes: 440,
  leftTodayMinutes: 310,
};

function cap(overrides: Partial<CapacityDTO> = {}): CapacityDTO {
  return { ...base, ...overrides };
}

describe("CapacityLine", () => {
  it("leads with the plan, then what it will really cost, then what is left", () => {
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByText(/4h 30m planned/)).toBeTruthy();
    expect(screen.getByText(/about 7h 20m at your pace/i)).toBeTruthy();
    expect(screen.getByText(/5h 10m left/i)).toBeTruthy();
  });

  it("says plainly when the day will not hold it", () => {
    render(<CapacityLine capacity={cap({ plannedMinutes: 270, forecastMinutes: 440, leftTodayMinutes: 310 })} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByText(/about 2h more than today holds/i)).toBeTruthy();
  });

  it("says nothing extra when the forecast still fits", () => {
    render(<CapacityLine capacity={cap({ forecastMinutes: 200, leftTodayMinutes: 310 })} meetings={4} onHours={vi.fn()} />);
    expect(screen.queryByText(/more than today holds/i)).toBeNull();
  });

  it("drops the middle figure and says why when there is no history yet", () => {
    render(<CapacityLine capacity={cap({ drift: null, forecastMinutes: null })} meetings={4} onHours={vi.fn()} />);
    expect(screen.queryByText(/at your pace/i)).toBeNull();
    expect(screen.getByText(/not enough finished work yet/i)).toBeTruthy();
  });

  it("holds its tongue when the page already has a region that speaks", () => {
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} quiet />);
    expect(screen.queryByRole("status")).toBeNull();
    // The words are all still there; only the announcement is gone.
    expect(screen.getByText(/4h 30m planned/)).toBeTruthy();
  });

  it("says how much of the plan has a place on the timeline", () => {
    render(<CapacityLine capacity={cap({ blockedMinutes: 80 })} meetings={4} onHours={vi.fn()} />);
    expect(screen.getByText(/1h 20m blocked/)).toBeTruthy();
  });

  it("says how much the day had no room for, after the blocked figure", () => {
    render(<CapacityLine capacity={cap({ blockedMinutes: 80, unplacedMinutes: 80 })} meetings={1} onHours={vi.fn()} />);
    expect(screen.getByText(/1h 20m blocked/)).toBeTruthy();
    expect(screen.getByText(/1h 20m unplaced/)).toBeTruthy();
    expect(screen.getByText(/1 meeting\b/)).toBeTruthy();
  });

  it("names the unestimated tasks", () => {
    render(<CapacityLine capacity={cap({ unestimated: 2 })} meetings={1} onHours={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("(2 unestimated)");
  });

  it("names the hours panel as the dialog the chip promises", () => {
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Working hours" })).toBeTruthy();
  });

  it("closes without saving when the trigger is clicked again", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Working hours" })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("textbox", { name: "Working hours" })).toBeNull();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("saves a changed value once when the click lands outside, and drops a bad one", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} />);
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
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "18:00-09:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Use HH:MM-HH:MM, start before end")).toBeTruthy();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("edits the hours from the chip", async () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "08:30-17:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onHours).toHaveBeenCalledWith("08:30-17:00"));
  });
});
