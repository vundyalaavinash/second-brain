import { describe, it, expect } from "vitest";
import { blockedMinutes, blockLength, unplacedMinutes, capacityTone, formatMinutes, freeMinutes, parseWorkHours, plannedMinutes } from "./capacity";

const DAY = "2026-09-23";
const m = (start: string, end: string, over: Partial<{ allDay: boolean; status: string }> = {}) => ({
  startsAt: `${DAY}T${start}:00`,
  endsAt: `${DAY}T${end}:00`,
  allDay: false,
  status: "accepted",
  ...over,
});

describe("capacity", () => {
  it("parses working hours and rejects nonsense", () => {
    expect(parseWorkHours("09:00-18:00")).toEqual({ start: 540, end: 1080 });
    expect(parseWorkHours("9:00-18:00")).toBeNull();
    expect(parseWorkHours("18:00-09:00")).toBeNull();
    expect(parseWorkHours("09:00-24:30")).toBeNull();
  });

  it("subtracts meetings inside the hours, merging overlaps and clipping to the edges", () => {
    expect(freeMinutes([], "09:00-18:00", DAY)).toBe(540);
    expect(freeMinutes([m("10:00", "10:30")], "09:00-18:00", DAY)).toBe(510);
    expect(freeMinutes([m("10:00", "11:00"), m("10:30", "11:30")], "09:00-18:00", DAY)).toBe(450);
    expect(freeMinutes([m("08:00", "09:30"), m("17:30", "19:00")], "09:00-18:00", DAY)).toBe(480);
    expect(freeMinutes([m("07:00", "08:00")], "09:00-18:00", DAY)).toBe(540);
  });

  it("ignores all-day and declined meetings and meetings on other days", () => {
    expect(freeMinutes([m("00:00", "23:59", { allDay: true }), m("10:00", "11:00", { status: "declined" })], "09:00-18:00", DAY)).toBe(540);
    expect(freeMinutes([{ ...m("10:00", "11:00"), startsAt: "2026-09-24T10:00:00", endsAt: "2026-09-24T11:00:00" }], "09:00-18:00", DAY)).toBe(540);
  });

  it("with no `now`, answers the whole window — every existing caller keeps today's behaviour", () => {
    expect(freeMinutes([m("10:00", "10:30")], "09:00-18:00", DAY)).toBe(510);
    expect(freeMinutes([m("10:00", "10:30")], "09:00-18:00", DAY, {})).toBe(510);
  });

  it("with `now`, a day already gone holds nothing", () => {
    const tomorrow = new Date(2026, 8, 24, 10, 0); // local 10:00 the day after DAY
    expect(freeMinutes([], "09:00-18:00", DAY, { now: tomorrow })).toBe(0);
  });

  it("with `now`, a future day is the whole window", () => {
    const now = new Date(2026, 8, 23, 10, 0); // local 10:00 on DAY itself
    expect(freeMinutes([], "09:00-18:00", "2026-09-24", { now })).toBe(540);
  });

  it("with `now`, today's window starts at the later of the hours' start and the current minute", () => {
    const midMorning = new Date(2026, 8, 23, 10, 30);
    expect(freeMinutes([], "09:00-18:00", DAY, { now: midMorning })).toBe(450); // 10:30 to 18:00
    const beforeHoursStart = new Date(2026, 8, 23, 7, 0);
    expect(freeMinutes([], "09:00-18:00", DAY, { now: beforeHoursStart })).toBe(540); // hours' own start wins
  });

  it("with `now`, a meeting still costs only the part after the current minute", () => {
    const midMorning = new Date(2026, 8, 23, 10, 30);
    expect(freeMinutes([m("10:00", "11:00")], "09:00-18:00", DAY, { now: midMorning })).toBe(420); // 10:30-11:00 taken, then to 18:00
  });

  it("with `now`, after the working day ends is zero", () => {
    const afterHours = new Date(2026, 8, 23, 19, 0);
    expect(freeMinutes([], "09:00-18:00", DAY, { now: afterHours })).toBe(0);
  });

  it("sums open estimates and counts the unestimated", () => {
    expect(
      plannedMinutes([
        { status: "open", estimateMinutes: 25 },
        { status: "open", estimateMinutes: null },
        { status: "done", estimateMinutes: 60 },
        { status: "open", estimateMinutes: 45 },
      ]),
    ).toEqual({ planned: 70, unestimated: 1 });
  });

  it("formats minutes the way the header reads them", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(130)).toBe("2h 10m");
  });

  it("counts the day's session minutes for open tasks only", () => {
    const tasks = [
      { status: "open", estimateMinutes: 60, blocks: [{ startsAt: "2026-09-23T10:00:00", minutes: 45 }, { startsAt: "2026-09-23T14:00:00", minutes: 15 }] },
      { status: "open", estimateMinutes: null, blocks: [{ startsAt: "2026-09-23T14:00:00", minutes: 25 }] },
      { status: "done", estimateMinutes: 30, blocks: [{ startsAt: "2026-09-23T15:00:00", minutes: 30 }] },
      { status: "open", estimateMinutes: 45, blocks: [{ startsAt: "2026-09-24T09:00:00", minutes: 45 }] },
      { status: "open", estimateMinutes: 45, blocks: [] },
    ];
    expect(blockLength({ estimateMinutes: null })).toBe(25);
    expect(blockedMinutes(tasks, "2026-09-23")).toBe(85);
  });

  it("counts what an estimate still wants and the day has no room for", () => {
    const tasks = [
      // Two hours wanted, 45 minutes placed: an hour and a quarter is unplaced.
      { status: "open", estimateMinutes: 120, blocks: [{ startsAt: "2026-09-23T10:00:00", minutes: 45 }] },
      // Placed past the estimate on the day, and a session on another day: neither asks for more.
      { status: "open", estimateMinutes: 30, blocks: [{ startsAt: "2026-09-23T12:00:00", minutes: 45 }] },
      { status: "open", estimateMinutes: 60, blocks: [{ startsAt: "2026-09-24T09:00:00", minutes: 60 }] },
      // A task nobody has estimated asks for nothing; a finished one is finished with.
      { status: "open", estimateMinutes: null, blocks: [] },
      { status: "done", estimateMinutes: 90, blocks: [] },
    ];
    expect(unplacedMinutes(tasks, "2026-09-23")).toBe(135);
  });

  it("tones the plan against the free time", () => {
    expect(capacityTone(200, 300)).toBe("ok");
    expect(capacityTone(300, 300)).toBe("ok");
    expect(capacityTone(301, 300)).toBe("warn");
    expect(capacityTone(376, 300)).toBe("danger");
    expect(capacityTone(0, 0)).toBe("ok");
    expect(capacityTone(30, 0)).toBe("danger");
  });
});
