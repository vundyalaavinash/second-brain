import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents } from "@/domain/activity";
import { addToPlan } from "@/domain/plan";
import { completeTask, createTask, deleteTask, dropTask, getTask } from "@/domain/tasks";
import { addBlock, blocksByTask, BlockError, clearBlocks, fillDay, listBlocks, placeTask, removeBlock, updateBlock } from "./index";

const DAY = "2026-10-05";
const NEXT = "2026-10-06";

/** The local day of a Date, the way the domain reads one. */
function localDay(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A timed meeting on `DAY`, so a placement has something to work around. */
function meeting(externalId: string, from: string, to: string, over: { status?: "declined"; allDay?: boolean } = {}) {
  return { externalId, title: "Sync", startsAt: `${DAY}T${from}:00`, endsAt: `${DAY}T${to}:00`, attendees: 2, hasCallLink: true, ...over };
}

describe("blocks domain", () => {
  let t: TestDb;
  beforeEach(() => {
    t = makeTestDb();
  });
  afterEach(() => t.cleanup());

  it("adds a session and refuses a bad start, a bad length, or an unknown task", () => {
    const task = createTask(t.db, { title: "Write" });
    const block = addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 45 });
    expect(block).toMatchObject({ taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 45 });
    expect(() => addBlock(t.db, { taskId: task.id, startsAt: `${DAY} 10:00`, minutes: 45 })).toThrow(/YYYY-MM-DDTHH:MM:SS/);
    expect(() => addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T25:00:00`, minutes: 45 })).toThrow(/YYYY-MM-DDTHH:MM:SS/);
    expect(() => addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 4 })).toThrow(/5 and 480/);
    expect(() => addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 481 })).toThrow(/5 and 480/);
    expect(() => addBlock(t.db, { taskId: 999, startsAt: `${DAY}T10:00:00`, minutes: 45 })).toThrow(BlockError);
  });

  it("moves and resizes a session, pulling the estimate up to the day's sessions", () => {
    const task = createTask(t.db, { title: "Write", estimateMinutes: 60 });
    const block = addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 45 });
    expect(updateBlock(t.db, block.id, { startsAt: `${DAY}T11:00:00` }).startsAt).toBe(`${DAY}T11:00:00`);
    // Still inside the hour the task was estimated at: the estimate is left alone.
    expect(updateBlock(t.db, block.id, { minutes: 50 }).minutes).toBe(50);
    expect(getTask(t.db, task.id)!.estimateMinutes).toBe(60);
    // Past it now, so the total grows to match what the day holds.
    addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T14:00:00`, minutes: 30 });
    updateBlock(t.db, block.id, { minutes: 60 });
    expect(getTask(t.db, task.id)!.estimateMinutes).toBe(90);
    expect(() => updateBlock(t.db, block.id, { minutes: 0 })).toThrow(/5 and 480/);
    expect(() => updateBlock(t.db, 999, { minutes: 30 })).toThrow(BlockError);
  });

  it("gives an unguessed task the estimate its sessions add up to", () => {
    const task = createTask(t.db, { title: "Write" });
    const block = addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 25 });
    updateBlock(t.db, block.id, { minutes: 90 });
    expect(getTask(t.db, task.id)!.estimateMinutes).toBe(90);
  });

  it("removes one session, clears a day's, and lists a day's in clock order", () => {
    const a = createTask(t.db, { title: "A" });
    const b = createTask(t.db, { title: "B" });
    const first = addBlock(t.db, { taskId: a.id, startsAt: `${DAY}T09:00:00`, minutes: 30 });
    addBlock(t.db, { taskId: a.id, startsAt: `${DAY}T15:00:00`, minutes: 30 });
    addBlock(t.db, { taskId: a.id, startsAt: `${NEXT}T09:00:00`, minutes: 30 });
    addBlock(t.db, { taskId: b.id, startsAt: `${DAY}T11:00:00`, minutes: 30 });
    expect(listBlocks(t.db, { date: DAY }).map((x) => [x.taskId, x.startsAt])).toEqual([
      [a.id, `${DAY}T09:00:00`],
      [b.id, `${DAY}T11:00:00`],
      [a.id, `${DAY}T15:00:00`],
    ]);
    removeBlock(t.db, first.id);
    expect(() => removeBlock(t.db, first.id)).toThrow(BlockError);
    expect(clearBlocks(t.db, a.id, DAY)).toBe(1);
    expect(listBlocks(t.db, { taskId: a.id }).map((x) => x.startsAt)).toEqual([`${NEXT}T09:00:00`]);
    const byTask = blocksByTask(t.db, [a.id, b.id]);
    expect(byTask.get(a.id)!.map((x) => x.startsAt)).toEqual([`${NEXT}T09:00:00`]);
    expect(byTask.get(b.id)!).toHaveLength(1);
  });

  it("lays a task's sessions into the free slots around meetings and other tasks", () => {
    replaceCalendarEvents(t.db, [meeting("m1", "10:00", "11:00"), meeting("m2", "16:00", "17:00", { status: "declined" })]);
    const other = createTask(t.db, { title: "Other" });
    addBlock(t.db, { taskId: other.id, startsAt: `${DAY}T14:00:00`, minutes: 60 });
    const task = createTask(t.db, { title: "Write", estimateMinutes: 120 });
    expect(placeTask(t.db, { taskId: task.id, date: DAY })).toEqual({ placed: 3, unplacedMinutes: 0 });
    const placed = listBlocks(t.db, { taskId: task.id });
    // 120 minutes at 45 apiece is 45 + 45 + 30, and ten minutes stand between two of them in
    // one slot. 09:00–09:45 fills the morning slot: the break would leave only five minutes
    // of it, under the floor, so the second session waits for the meeting to end at 11:00 and
    // starts there with no break before it. The third takes its break: 11:55–12:25.
    expect(placed.map((b) => [b.startsAt.slice(11, 16), b.minutes])).toEqual([
      ["09:00", 45],
      ["11:00", 45],
      ["11:55", 30],
    ]);
    expect(placed.reduce((n, b) => n + b.minutes, 0)).toBe(120);
    // A declined meeting is not busy, and nothing lands inside the one that stands.
    expect(placed.some((b) => b.startsAt >= `${DAY}T10:00:00` && b.startsAt < `${DAY}T11:00:00`)).toBe(false);
  });

  it("starts no earlier than now when the day is today", () => {
    const now = new Date();
    now.setHours(12, 7, 0, 0);
    const today = localDay(now);
    const task = createTask(t.db, { title: "Write", estimateMinutes: 30 });
    expect(placeTask(t.db, { taskId: task.id, date: today, now })).toEqual({ placed: 1, unplacedMinutes: 0 });
    expect(listBlocks(t.db, { taskId: task.id })[0].startsAt).toBe(`${today}T12:10:00`);
  });

  it("re-places a task over its own day and leaves its other days alone", () => {
    const task = createTask(t.db, { title: "Write", estimateMinutes: 60, sessionMinutes: 30 });
    addBlock(t.db, { taskId: task.id, startsAt: `${NEXT}T09:00:00`, minutes: 60 });
    placeTask(t.db, { taskId: task.id, date: DAY });
    const first = listBlocks(t.db, { taskId: task.id, date: DAY }).map((b) => b.id);
    expect(first).toHaveLength(2);
    placeTask(t.db, { taskId: task.id, date: DAY });
    const second = listBlocks(t.db, { taskId: task.id, date: DAY });
    expect(second).toHaveLength(2);
    // Fresh rows, in the same places: the old ones went before the new ones were laid.
    expect(second.some((b) => first.includes(b.id))).toBe(false);
    // 09:00–09:30, ten minutes off, 09:40–10:10: both sessions sit in the one free slot.
    expect(second.map((b) => b.startsAt.slice(11, 16))).toEqual(["09:00", "09:40"]);
    expect(listBlocks(t.db, { taskId: task.id, date: NEXT }).map((b) => b.startsAt)).toEqual([`${NEXT}T09:00:00`]);
  });

  it("reports what the day had no room for", () => {
    replaceCalendarEvents(t.db, [meeting("m1", "09:00", "17:30")]);
    const task = createTask(t.db, { title: "Write", estimateMinutes: 90 });
    expect(placeTask(t.db, { taskId: task.id, date: DAY })).toEqual({ placed: 1, unplacedMinutes: 60 });
    expect(listBlocks(t.db, { taskId: task.id }).map((b) => [b.startsAt.slice(11, 16), b.minutes])).toEqual([["17:30", 30]]);
  });

  it("places a task nobody has estimated as one 25-minute session", () => {
    const task = createTask(t.db, { title: "Write" });
    expect(placeTask(t.db, { taskId: task.id, date: DAY })).toEqual({ placed: 1, unplacedMinutes: 0 });
    expect(listBlocks(t.db, { taskId: task.id }).map((b) => b.minutes)).toEqual([25]);
  });

  it("refuses to place an unknown task or a date that is not a date", () => {
    const task = createTask(t.db, { title: "Write" });
    expect(() => placeTask(t.db, { taskId: 999, date: DAY })).toThrow(BlockError);
    expect(() => placeTask(t.db, { taskId: task.id, date: "05-10-2026" })).toThrow(/YYYY-MM-DD/);
    expect(() => fillDay(t.db, { date: "nope" })).toThrow(/YYYY-MM-DD/);
  });

  it("fills the day for the open plan tasks that hold no session yet", () => {
    const blocked = createTask(t.db, { title: "Already placed", estimateMinutes: 30 });
    const open = createTask(t.db, { title: "Waiting", estimateMinutes: 60 });
    const done = createTask(t.db, { title: "Finished", estimateMinutes: 60 });
    const offPlan = createTask(t.db, { title: "Not on the plan", estimateMinutes: 60 });
    addBlock(t.db, { taskId: blocked.id, startsAt: `${DAY}T09:00:00`, minutes: 30 });
    for (const task of [blocked, open, done]) addToPlan(t.db, DAY, task.id);
    completeTask(t.db, done.id);
    expect(fillDay(t.db, { date: DAY })).toEqual({ placed: 1, unplacedMinutes: 0 });
    expect(listBlocks(t.db, { taskId: open.id }).map((b) => [b.startsAt.slice(11, 16), b.minutes])).toEqual([["09:30", 60]]);
    expect(listBlocks(t.db, { taskId: blocked.id })).toHaveLength(1);
    expect(listBlocks(t.db, { taskId: offPlan.id })).toEqual([]);
    expect(listBlocks(t.db, { taskId: done.id })).toEqual([]);
  });

  it("gives the day's hours back when a task is dropped", () => {
    const first = createTask(t.db, { title: "Abandoned", estimateMinutes: 60 });
    placeTask(t.db, { taskId: first.id, date: DAY });
    expect(listBlocks(t.db, { taskId: first.id, date: DAY }).map((b) => b.startsAt.slice(11, 16))).toEqual(["09:00"]);
    dropTask(t.db, first.id);
    // The sessions go with it, so the day reads as empty again.
    expect(listBlocks(t.db, { date: DAY })).toEqual([]);
    const next = createTask(t.db, { title: "Instead", estimateMinutes: 60 });
    placeTask(t.db, { taskId: next.id, date: DAY });
    expect(listBlocks(t.db, { taskId: next.id, date: DAY }).map((b) => b.startsAt.slice(11, 16))).toEqual(["09:00"]);
  });

  it("leaves a dropped task's leftover session out of the busy hours", () => {
    const dropped = createTask(t.db, { title: "Abandoned", estimateMinutes: 60 });
    addBlock(t.db, { taskId: dropped.id, startsAt: `${DAY}T09:00:00`, minutes: 60 });
    // Straight to the row, the way an older write left one behind: the status alone must do it.
    dropTask(t.db, dropped.id);
    addBlock(t.db, { taskId: dropped.id, startsAt: `${DAY}T09:00:00`, minutes: 60 });
    const task = createTask(t.db, { title: "Write", estimateMinutes: 60 });
    placeTask(t.db, { taskId: task.id, date: DAY });
    expect(listBlocks(t.db, { taskId: task.id, date: DAY }).map((b) => b.startsAt.slice(11, 16))).toEqual(["09:00"]);
  });

  it("fills the day once: a second run finds every plan task already placed", () => {
    const a = createTask(t.db, { title: "First", estimateMinutes: 60 });
    const b = createTask(t.db, { title: "Second", estimateMinutes: 30 });
    for (const task of [a, b]) addToPlan(t.db, DAY, task.id);
    expect(fillDay(t.db, { date: DAY })).toEqual({ placed: 2, unplacedMinutes: 0 });
    const before = listBlocks(t.db, { date: DAY }).map((x) => [x.taskId, x.startsAt, x.minutes]);
    expect(fillDay(t.db, { date: DAY })).toEqual({ placed: 0, unplacedMinutes: 0 });
    expect(listBlocks(t.db, { date: DAY }).map((x) => [x.taskId, x.startsAt, x.minutes])).toEqual(before);
  });

  it("places nothing on a day whose working hours are already behind now", () => {
    const now = new Date();
    now.setHours(23, 30, 0, 0);
    const today = localDay(now);
    const task = createTask(t.db, { title: "Too late", estimateMinutes: 45 });
    addToPlan(t.db, today, task.id);
    expect(placeTask(t.db, { taskId: task.id, date: today, now })).toEqual({ placed: 0, unplacedMinutes: 45 });
    expect(fillDay(t.db, { date: today, now })).toEqual({ placed: 0, unplacedMinutes: 45 });
    expect(listBlocks(t.db, { date: today })).toEqual([]);
  });

  it("takes a task's sessions with it when the task is deleted", () => {
    const task = createTask(t.db, { title: "Write" });
    addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 30 });
    deleteTask(t.db, task.id);
    expect(listBlocks(t.db, { taskId: task.id })).toEqual([]);
  });
});
