import { describe, expect, it } from "vitest";
import { makeTestDb } from "@/test/db";
import { setFocusSettings } from "./index";
import { breakState, endBreak, nextBreakMinutes, startBreak } from "./break";

const NOW = new Date("2026-10-12T10:00:00.000Z");

describe("nextBreakMinutes", () => {
  it("is the short break between pomodoros", () => {
    const t = makeTestDb();
    try {
      setFocusSettings(t.db, { shortBreak: 5, longBreak: 15, longBreakEvery: 4 });
      expect(nextBreakMinutes(t.db, 1)).toBe(5);
      expect(nextBreakMinutes(t.db, 3)).toBe(5);
    } finally {
      t.cleanup();
    }
  });

  it("is the long break on every fourth one", () => {
    const t = makeTestDb();
    try {
      setFocusSettings(t.db, { shortBreak: 5, longBreak: 15, longBreakEvery: 4 });
      expect(nextBreakMinutes(t.db, 4)).toBe(15);
      expect(nextBreakMinutes(t.db, 8)).toBe(15);
    } finally {
      t.cleanup();
    }
  });

  /** Nothing completed yet is not "a multiple of four"; the first break is a short one. */
  it("is the short break before any pomodoro has finished", () => {
    const t = makeTestDb();
    try {
      setFocusSettings(t.db, { shortBreak: 5, longBreak: 15, longBreakEvery: 4 });
      expect(nextBreakMinutes(t.db, 0)).toBe(5);
    } finally {
      t.cleanup();
    }
  });
});

describe("a break", () => {
  it("is not running until one is started", () => {
    const t = makeTestDb();
    try {
      expect(breakState(t.db, NOW)).toEqual({ endsAt: null, remainingMs: 0, minutes: 0 });
    } finally {
      t.cleanup();
    }
  });

  /** The whole point: it lives in the database, not in one page's component state, so walking to
   *  another page and back does not silently cancel it. */
  it("survives being read by something that never saw it start", () => {
    const t = makeTestDb();
    try {
      startBreak(t.db, 5, NOW);
      const later = new Date(NOW.getTime() + 120_000);
      const state = breakState(t.db, later);
      expect(state.endsAt).toBe(new Date(NOW.getTime() + 300_000).toISOString());
      expect(state.remainingMs).toBe(180_000);
      expect(state.minutes).toBe(5);
    } finally {
      t.cleanup();
    }
  });

  it("is over once its time is up, rather than counting into the negative", () => {
    const t = makeTestDb();
    try {
      startBreak(t.db, 5, NOW);
      const state = breakState(t.db, new Date(NOW.getTime() + 600_000));
      expect(state.endsAt).toBeNull();
      expect(state.remainingMs).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  it("can be ended early", () => {
    const t = makeTestDb();
    try {
      startBreak(t.db, 15, NOW);
      endBreak(t.db);
      expect(breakState(t.db, NOW).endsAt).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it("replaces a running break rather than stacking two", () => {
    const t = makeTestDb();
    try {
      startBreak(t.db, 5, NOW);
      startBreak(t.db, 15, NOW);
      expect(breakState(t.db, NOW).minutes).toBe(15);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a length outside the settings' own bounds", () => {
    const t = makeTestDb();
    try {
      expect(() => startBreak(t.db, 0, NOW)).toThrow();
      expect(() => startBreak(t.db, 61, NOW)).toThrow();
    } finally {
      t.cleanup();
    }
  });

  // A stored value that is not a date at all must read as "no break", not crash the pane that
  // asks for it or strand someone in a break that can never end.
  it("reads a corrupt stored value as no break", () => {
    const t = makeTestDb();
    try {
      startBreak(t.db, 5, NOW);
      t.db.$client.prepare("UPDATE settings SET value = 'not a date' WHERE key LIKE 'focus.break%'").run();
      expect(breakState(t.db, NOW).endsAt).toBeNull();
    } finally {
      t.cleanup();
    }
  });
});
