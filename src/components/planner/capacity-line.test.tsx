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
  workingDays: [1, 2, 3, 4, 5],
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
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByText(/4h 30m planned/)).toBeTruthy();
    expect(screen.getByText(/about 7h 20m at your pace/i)).toBeTruthy();
    expect(screen.getByText(/5h 10m left/i)).toBeTruthy();
  });

  it("says plainly when the day will not hold it", () => {
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByText(/about 2h more than today holds/i)).toBeTruthy();
  });

  it("says nothing extra when the forecast still fits", () => {
    render(<CapacityLine capacity={cap({ forecastMinutes: 200, leftTodayMinutes: 310 })} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.queryByText(/more than today holds/i)).toBeNull();
  });

  it("drops the middle figure and says why when there is no history yet", () => {
    render(<CapacityLine capacity={cap({ drift: null, forecastMinutes: null })} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.queryByText(/at your pace/i)).toBeNull();
    expect(screen.getByText(/not enough finished work yet/i)).toBeTruthy();
  });

  it("still says the day will not hold it with no forecast, from the plan itself", () => {
    // No drift yet — the shipping default for a new install — but 10h planned against 2h left
    // is overcommitted whether or not there is a forecast to say so.
    render(<CapacityLine capacity={cap({ drift: null, forecastMinutes: null, plannedMinutes: 600, leftTodayMinutes: 120 })} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.queryByText(/at your pace/i)).toBeNull();
    expect(screen.getByText(/about 8h more than today holds/i)).toBeTruthy();
    // The explanation for the missing middle figure is still there alongside the alarm.
    expect(screen.getByText(/not enough finished work yet/i)).toBeTruthy();
  });

  it("never rounds a partial-hour overrun up to the next hour", () => {
    // 30 minutes over is 30 minutes over, not "about 1h" — Math.round would say the latter.
    render(<CapacityLine capacity={cap({ forecastMinutes: 150, leftTodayMinutes: 120 })} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByText(/about 30m more than today holds/i)).toBeTruthy();
    expect(screen.queryByText(/about 1h more/i)).toBeNull();
  });

  it("says nothing about meetings when there are none to name", () => {
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.queryByText(/meeting/i)).toBeNull();
  });

  it("carries no colour alarm — the sentence is the only one", () => {
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.querySelector(".text-warn, .text-danger")).toBeNull();
  });

  it("announces the missing-history explanation inside the same live region as the figures", () => {
    render(<CapacityLine capacity={cap({ drift: null, forecastMinutes: null })} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Not enough finished work yet to know how your estimates run.");
    expect(status.querySelector(".text-fg-faint")).toBeTruthy();
  });

  it("holds its tongue when the page already has a region that speaks", () => {
    render(<CapacityLine capacity={cap()} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} quiet />);
    expect(screen.queryByRole("status")).toBeNull();
    // The words are all still there; only the announcement is gone.
    expect(screen.getByText(/4h 30m planned/)).toBeTruthy();
  });

  it("says how much of the plan has a place on the timeline", () => {
    render(<CapacityLine capacity={cap({ blockedMinutes: 80 })} meetings={4} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByText(/1h 20m blocked/)).toBeTruthy();
  });

  it("says how much the day had no room for, after the blocked figure", () => {
    render(<CapacityLine capacity={cap({ blockedMinutes: 80, unplacedMinutes: 80 })} meetings={1} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByText(/1h 20m blocked/)).toBeTruthy();
    expect(screen.getByText(/1h 20m unplaced/)).toBeTruthy();
    expect(screen.getByText(/1 meeting\b/)).toBeTruthy();
  });

  it("names the unestimated tasks", () => {
    render(<CapacityLine capacity={cap({ unestimated: 2 })} meetings={1} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("(2 unestimated)");
  });

  it("names the hours panel as the dialog the chip promises", () => {
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Working hours" })).toBeTruthy();
  });

  it("closes without saving when the trigger is clicked again", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} onWorkingDays={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Hours 09:00-18:00" });
    fireEvent.click(trigger);
    expect(screen.getByRole("textbox", { name: "Working hours" })).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("textbox", { name: "Working hours" })).toBeNull();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("saves a changed value once when the click lands outside, and drops a bad one", () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} onWorkingDays={vi.fn()} />);
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
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} onWorkingDays={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "18:00-09:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(screen.getByText("Use HH:MM-HH:MM, start before end")).toBeTruthy();
    expect(onHours).not.toHaveBeenCalled();
  });

  it("edits the hours from the chip", async () => {
    const onHours = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={onHours} onWorkingDays={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Hours 09:00-18:00" }));
    const field = screen.getByRole("textbox", { name: "Working hours" });
    fireEvent.change(field, { target: { value: "08:30-17:00" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onHours).toHaveBeenCalledWith("08:30-17:00"));
  });

  // F4: `setWorkingDays` and the route existed with no control that ever sent it — this chip is
  // that control, beside the hours one it names in `aria-label` the same way.
  it("names the days chip beside the hours one, defaulting to the saved days", () => {
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} onWorkingDays={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Days Mon-Fri" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Working days" })).toBeTruthy();
  });

  it("toggles a day off and saves once the click lands outside", () => {
    const onWorkingDays = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} onWorkingDays={onWorkingDays} />);
    fireEvent.click(screen.getByRole("button", { name: "Days Mon-Fri" }));
    fireEvent.click(screen.getByRole("button", { name: "Friday" }));
    fireEvent.mouseDown(document.body);
    expect(onWorkingDays).toHaveBeenCalledTimes(1);
    expect(onWorkingDays).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it("refuses to toggle off the last working day", () => {
    const onWorkingDays = vi.fn();
    render(<CapacityLine capacity={cap({ workingDays: [1] })} meetings={0} onHours={vi.fn()} onWorkingDays={onWorkingDays} />);
    fireEvent.click(screen.getByRole("button", { name: "Days M" }));
    const mon = screen.getByRole("button", { name: "Monday" });
    expect(mon.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(mon);
    expect(screen.getByText("Pick at least one working day")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(onWorkingDays).not.toHaveBeenCalled();
  });

  it("adds a day and saves it, sorted, on the same round trip as the hours chip", () => {
    const onWorkingDays = vi.fn();
    render(<CapacityLine capacity={cap()} meetings={0} onHours={vi.fn()} onWorkingDays={onWorkingDays} />);
    fireEvent.click(screen.getByRole("button", { name: "Days Mon-Fri" }));
    fireEvent.click(screen.getByRole("button", { name: "Saturday" }));
    fireEvent.mouseDown(document.body);
    expect(onWorkingDays).toHaveBeenCalledWith([1, 2, 3, 4, 5, 6]);
  });
});
