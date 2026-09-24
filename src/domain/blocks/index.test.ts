import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import { replaceCalendarEvents } from "@/domain/activity";
import { addToPlan } from "@/domain/plan";
import { completeTask, createTask, deleteTask, getTask } from "@/domain/tasks";
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

  it("leaves an unguessed estimate unguessed when a session grows", () => {
    const task = createTask(t.db, { title: "Write" });
    const block = addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 25 });
    updateBlock(t.db, block.id, { minutes: 90 });
    expect(getTask(t.db, task.id)!.estimateMinutes).toBeNull();
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
    expect(placeTask(t.db, { taskId: task.id, date: DAY })).toEqual({ placed: 4, unplacedMinutes: 0 });
    const placed = listBlocks(t.db, { taskId: task.id });
    // 09:00 fills to the meeting, the rest of that session waits for it to end.
    expect(placed.map((b) => [b.startsAt.slice(11, 16), b.minutes])).toEqual([
      ["09:00", 45],
      ["09:45", 15],
      ["11:00", 30],
      ["11:30", 30],
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
    expect(second.map((b) => b.startsAt.slice(11, 16))).toEqual(["09:00", "09:30"]);
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

  it("takes a task's sessions with it when the task is deleted", () => {
    const task = createTask(t.db, { title: "Write" });
    addBlock(t.db, { taskId: task.id, startsAt: `${DAY}T10:00:00`, minutes: 30 });
    deleteTask(t.db, task.id);
    expect(listBlocks(t.db, { taskId: task.id })).toEqual([]);
  });
});
