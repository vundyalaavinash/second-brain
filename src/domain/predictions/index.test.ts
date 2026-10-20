import { describe, expect, it } from "vitest";
import { makeTestDb, type TestDb } from "@/test/db";
import {
  createPrediction,
  deletePrediction,
  duePredictions,
  getPrediction,
  listPredictions,
  predictionScores,
  resolvePrediction,
  unresolvePrediction,
  updatePrediction,
} from "./index";

const RESOLVE_BY = "2026-11-30";

function estimate(t: TestDb, over: Partial<Parameters<typeof createPrediction>[1]> = {}) {
  return createPrediction(t.db, {
    kind: "estimate",
    claim: "Ledger migration",
    resolveBy: RESOLVE_BY,
    unit: "days",
    p50Low: 4,
    p50High: 6,
    p90Low: 3,
    p90High: 12,
    ...over,
  } as Parameters<typeof createPrediction>[1]);
}

describe("createPrediction", () => {
  it("logs an estimate with its two ranges and nothing else", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      expect(row.kind).toBe("estimate");
      expect([row.p50Low, row.p50High, row.p90Low, row.p90High]).toEqual([4, 6, 3, 12]);
      expect(row.unit).toBe("days");
      // The columns this kind does not use stay empty, which is what the score functions rely on.
      expect(row.probability).toBeNull();
      expect(row.outcome).toBeNull();
      expect(row.actual).toBeNull();
      expect(row.resolvedAt).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it("logs a risk call with its probability and no ranges", () => {
    const t = makeTestDb();
    try {
      const row = createPrediction(t.db, { kind: "risk", claim: "Reconciliation bug by launch + 30d", resolveBy: RESOLVE_BY, probability: 0.3 });
      expect(row.probability).toBe(0.3);
      expect(row.p50Low).toBeNull();
      expect(row.p90High).toBeNull();
      expect(row.unit).toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it("logs a bare call with no numbers at all", () => {
    const t = makeTestDb();
    try {
      const row = createPrediction(t.db, { kind: "call", claim: "Root cause was a retry storm", resolveBy: RESOLVE_BY });
      expect(row.probability).toBeNull();
      expect(row.p90Low).toBeNull();
      expect(row.claim).toBe("Root cause was a retry storm");
    } finally {
      t.cleanup();
    }
  });

  it("refuses a claim that is only whitespace", () => {
    const t = makeTestDb();
    try {
      expect(() => createPrediction(t.db, { kind: "call", claim: "   ", resolveBy: RESOLVE_BY })).toThrow(/needs a claim/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a resolve-by that is not a date", () => {
    const t = makeTestDb();
    try {
      expect(() => createPrediction(t.db, { kind: "call", claim: "x", resolveBy: "soon" })).toThrow(/resolves by/);
    } finally {
      t.cleanup();
    }
  });

  /** The invariant the whole calibration figure rests on: a 90% range narrower than the 50% one
   *  is a typo, and accepting it would quietly make every later percentage meaningless. */
  it("refuses a 90% range that does not contain the 50% range", () => {
    const t = makeTestDb();
    try {
      expect(() => estimate(t, { p90Low: 5, p90High: 12 })).toThrow(/contain the 50% range/);
      expect(() => estimate(t, { p90Low: 3, p90High: 5 })).toThrow(/contain the 50% range/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a range that runs backwards", () => {
    const t = makeTestDb();
    try {
      expect(() => estimate(t, { p50Low: 6, p50High: 4 })).toThrow(/50% range runs backwards/);
      expect(() => estimate(t, { p50Low: 4, p50High: 4, p90Low: 12, p90High: 3 })).toThrow(/90% range runs backwards/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a negative estimate", () => {
    const t = makeTestDb();
    try {
      expect(() => estimate(t, { p90Low: -1 })).toThrow(/cannot be negative/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a probability outside 0 to 1", () => {
    const t = makeTestDb();
    try {
      expect(() => createPrediction(t.db, { kind: "risk", claim: "x", resolveBy: RESOLVE_BY, probability: 1.5 })).toThrow(/between 0 and 1/);
      expect(() => createPrediction(t.db, { kind: "risk", claim: "x", resolveBy: RESOLVE_BY, probability: -0.1 })).toThrow(/between 0 and 1/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a probability that is not a number", () => {
    const t = makeTestDb();
    try {
      expect(() => createPrediction(t.db, { kind: "risk", claim: "x", resolveBy: RESOLVE_BY, probability: Number.NaN })).toThrow(/must be a number/);
    } finally {
      t.cleanup();
    }
  });
});

describe("resolvePrediction", () => {
  it("writes the actual and marks an estimate resolved", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      const done = resolvePrediction(t.db, row.id, { actual: 7 });
      expect(done.actual).toBe(7);
      expect(done.resolvedAt).not.toBeNull();
    } finally {
      t.cleanup();
    }
  });

  it("writes a risk outcome as one or zero", () => {
    const t = makeTestDb();
    try {
      const yes = createPrediction(t.db, { kind: "risk", claim: "a", resolveBy: RESOLVE_BY, probability: 0.3 });
      const no = createPrediction(t.db, { kind: "risk", claim: "b", resolveBy: RESOLVE_BY, probability: 0.3 });
      expect(resolvePrediction(t.db, yes.id, { outcome: true }).outcome).toBe(1);
      expect(resolvePrediction(t.db, no.id, { outcome: false }).outcome).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  /** `false` is an answer, not a missing one -- a risk that did not happen is the common case. */
  it("takes a false outcome as resolved rather than as nothing said", () => {
    const t = makeTestDb();
    try {
      const row = createPrediction(t.db, { kind: "call", claim: "a", resolveBy: RESOLVE_BY });
      const done = resolvePrediction(t.db, row.id, { outcome: false });
      expect(done.resolvedAt).not.toBeNull();
      expect(listPredictions(t.db, { state: "open" })).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  });

  it("refuses an estimate resolved with no actual", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      expect(() => resolvePrediction(t.db, row.id, { outcome: true })).toThrow(/must be a number/);
    } finally {
      t.cleanup();
    }
  });

  it("refuses a risk resolved with no outcome", () => {
    const t = makeTestDb();
    try {
      const row = createPrediction(t.db, { kind: "risk", claim: "a", resolveBy: RESOLVE_BY, probability: 0.3 });
      expect(() => resolvePrediction(t.db, row.id, { actual: 3 })).toThrow(/whether it happened/);
    } finally {
      t.cleanup();
    }
  });

  it("404s on a prediction that is not there", () => {
    const t = makeTestDb();
    try {
      expect(() => resolvePrediction(t.db, 999, { outcome: true })).toThrow(/not found/i);
    } finally {
      t.cleanup();
    }
  });

  it("can be corrected, and can be put back to open", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      resolvePrediction(t.db, row.id, { actual: 7 });
      expect(resolvePrediction(t.db, row.id, { actual: 9 }).actual).toBe(9);
      const open = unresolvePrediction(t.db, row.id);
      expect(open.resolvedAt).toBeNull();
      expect(open.actual).toBeNull();
    } finally {
      t.cleanup();
    }
  });
});

describe("duePredictions", () => {
  it("names the unresolved calls whose date has come, oldest first", () => {
    const t = makeTestDb();
    try {
      createPrediction(t.db, { kind: "call", claim: "late", resolveBy: "2026-10-01" });
      createPrediction(t.db, { kind: "call", claim: "today", resolveBy: "2026-10-20" });
      createPrediction(t.db, { kind: "call", claim: "later", resolveBy: "2026-12-01" });
      const due = duePredictions(t.db, "2026-10-20");
      expect(due.map((p) => p.claim)).toEqual(["late", "today"]);
    } finally {
      t.cleanup();
    }
  });

  it("drops a call once it has been resolved", () => {
    const t = makeTestDb();
    try {
      const row = createPrediction(t.db, { kind: "call", claim: "late", resolveBy: "2026-10-01" });
      resolvePrediction(t.db, row.id, { outcome: true });
      expect(duePredictions(t.db, "2026-10-20")).toHaveLength(0);
    } finally {
      t.cleanup();
    }
  });
});

describe("listPredictions", () => {
  it("puts the open ones first and the newest first within each", () => {
    const t = makeTestDb();
    try {
      const first = createPrediction(t.db, { kind: "call", claim: "first", resolveBy: RESOLVE_BY });
      createPrediction(t.db, { kind: "call", claim: "second", resolveBy: RESOLVE_BY });
      resolvePrediction(t.db, first.id, { outcome: true });
      expect(listPredictions(t.db).map((p) => p.claim)).toEqual(["second", "first"]);
    } finally {
      t.cleanup();
    }
  });

  it("filters by kind and by state", () => {
    const t = makeTestDb();
    try {
      estimate(t);
      createPrediction(t.db, { kind: "risk", claim: "r", resolveBy: RESOLVE_BY, probability: 0.3 });
      expect(listPredictions(t.db, { kind: "risk" })).toHaveLength(1);
      expect(listPredictions(t.db, { state: "resolved" })).toHaveLength(0);
      expect(listPredictions(t.db, { state: "open" })).toHaveLength(2);
    } finally {
      t.cleanup();
    }
  });
});

describe("updatePrediction", () => {
  it("edits the claim, the date and the notes", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      const edited = updatePrediction(t.db, row.id, { claim: "  Ledger cut-over  ", resolveBy: "2026-12-15", notes: " widened after a chat " });
      expect(edited.claim).toBe("Ledger cut-over");
      expect(edited.resolveBy).toBe("2026-12-15");
      expect(edited.notes).toBe("widened after a chat");
    } finally {
      t.cleanup();
    }
  });

  /** The stated numbers are not in the patch type at all -- this is the guarantee that makes
   *  every score honest, so it is asserted rather than left to the type checker. */
  it("leaves the stated ranges exactly as they were called", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      updatePrediction(t.db, row.id, { claim: "renamed" });
      const after = getPrediction(t.db, row.id)!;
      expect([after.p50Low, after.p50High, after.p90Low, after.p90High]).toEqual([4, 6, 3, 12]);
    } finally {
      t.cleanup();
    }
  });

  it("refuses to blank the claim", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      expect(() => updatePrediction(t.db, row.id, { claim: " " })).toThrow(/needs a claim/);
    } finally {
      t.cleanup();
    }
  });

  it("returns the row unchanged when the patch is empty", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      expect(updatePrediction(t.db, row.id, {}).updatedAt).toBe(row.updatedAt);
    } finally {
      t.cleanup();
    }
  });
});

describe("deletePrediction", () => {
  it("removes the row and 404s on one that is not there", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      deletePrediction(t.db, row.id);
      expect(getPrediction(t.db, row.id)).toBeUndefined();
      expect(() => deletePrediction(t.db, row.id)).toThrow(/not found/i);
    } finally {
      t.cleanup();
    }
  });
});

describe("predictionScores", () => {
  it("counts every call logged and scores only the resolved ones", () => {
    const t = makeTestDb();
    try {
      const inRange = estimate(t);
      const outside = estimate(t);
      estimate(t); // never resolved
      resolvePrediction(t.db, inRange.id, { actual: 7 });
      resolvePrediction(t.db, outside.id, { actual: 30 });

      const scores = predictionScores(t.db);
      expect(scores.estimate.logged).toBe(3);
      expect(scores.estimate.resolved).toBe(2);
      expect(scores.estimate.percent).toBe(50);
    } finally {
      t.cleanup();
    }
  });

  it("scores risks by Brier and bare calls by hit rate", () => {
    const t = makeTestDb();
    try {
      const a = createPrediction(t.db, { kind: "risk", claim: "a", resolveBy: RESOLVE_BY, probability: 0.5 });
      const b = createPrediction(t.db, { kind: "risk", claim: "b", resolveBy: RESOLVE_BY, probability: 0.5 });
      resolvePrediction(t.db, a.id, { outcome: true });
      resolvePrediction(t.db, b.id, { outcome: false });

      const c = createPrediction(t.db, { kind: "call", claim: "c", resolveBy: RESOLVE_BY });
      resolvePrediction(t.db, c.id, { outcome: true });

      const scores = predictionScores(t.db);
      expect(scores.risk.score).toBe(0.25);
      expect(scores.call.percent).toBe(100);
    } finally {
      t.cleanup();
    }
  });

  /** Nothing resolved reads as "not yet", never as zero: a fresh log must not report that you
   *  are bad at estimating when it only means you have not finished anything. */
  it("reports no score at all on an empty log", () => {
    const t = makeTestDb();
    try {
      const scores = predictionScores(t.db);
      expect(scores.estimate.percent).toBeNull();
      expect(scores.risk.score).toBeNull();
      expect(scores.call.percent).toBeNull();
      expect(scores.estimate.logged).toBe(0);
    } finally {
      t.cleanup();
    }
  });

  /** The weekly review asks for one week. A call made at any hour of the last day is in it. */
  it("includes a call made late on the window's last day", () => {
    const t = makeTestDb();
    try {
      const row = estimate(t);
      const day = row.createdAt.slice(0, 10);
      expect(predictionScores(t.db, { from: day, to: day }).estimate.logged).toBe(1);
    } finally {
      t.cleanup();
    }
  });
});
