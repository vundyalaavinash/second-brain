import { describe, expect, it } from "vitest";
import type { PredictionDTO } from "@/lib/dto";
import { inRange, resolvedAs, statedAs } from "./format";

function pred(over: Partial<PredictionDTO> = {}): PredictionDTO {
  return {
    id: 1,
    kind: "estimate",
    claim: "Ledger migration",
    containerId: null,
    taskId: null,
    itemId: null,
    unit: "days",
    p50Low: 4,
    p50High: 6,
    p90Low: 3,
    p90High: 12,
    actual: null,
    probability: null,
    outcome: null,
    resolveBy: "2026-11-30",
    resolvedAt: null,
    notes: "",
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...over,
  };
}

describe("statedAs", () => {
  it("writes an estimate as the two ranges it was called as", () => {
    expect(statedAs(pred())).toBe("4–6 likely, 3–12 at 90% days");
  });

  /** A range of one number is a number, not "4–4". */
  it("collapses a range whose ends are the same", () => {
    expect(statedAs(pred({ p50Low: 5, p50High: 5 }))).toBe("5 likely, 3–12 at 90% days");
  });

  it("rounds a fractional bound to one place", () => {
    expect(statedAs(pred({ p50Low: 1.25, p50High: 2.5 }))).toBe("1.3–2.5 likely, 3–12 at 90% days");
  });

  it("writes a risk as a percentage", () => {
    expect(statedAs(pred({ kind: "risk", probability: 0.3, p50Low: null, p50High: null, p90Low: null, p90High: null, unit: null }))).toBe("30%");
  });

  it("has nothing to say about a bare call", () => {
    expect(statedAs(pred({ kind: "call", p50Low: null, p50High: null, p90Low: null, p90High: null, unit: null }))).toBe("");
  });
});

describe("resolvedAs", () => {
  it("says nothing while the call is still open", () => {
    expect(resolvedAs(pred())).toBe("");
  });

  it("says what an estimate actually took", () => {
    expect(resolvedAs(pred({ actual: 7, resolvedAt: "2026-11-01T00:00:00.000Z" }))).toBe("took 7 days");
  });

  it("says whether a risk happened", () => {
    const risk = { kind: "risk" as const, probability: 0.3, resolvedAt: "2026-11-01T00:00:00.000Z" };
    expect(resolvedAs(pred({ ...risk, outcome: 1 }))).toBe("it happened");
    expect(resolvedAs(pred({ ...risk, outcome: 0 }))).toBe("it did not happen");
  });

  it("says whether a bare call was right", () => {
    const call = { kind: "call" as const, resolvedAt: "2026-11-01T00:00:00.000Z" };
    expect(resolvedAs(pred({ ...call, outcome: 1 }))).toBe("right");
    expect(resolvedAs(pred({ ...call, outcome: 0 }))).toBe("wrong");
  });
});

describe("inRange", () => {
  it("is true when the actual landed inside the 90% range", () => {
    expect(inRange(pred({ actual: 7, resolvedAt: "x" }))).toBe(true);
  });

  it("is false when it landed outside", () => {
    expect(inRange(pred({ actual: 30, resolvedAt: "x" }))).toBe(false);
  });

  /** Null is "nothing to say", not "missed": a risk call has no range to miss. */
  it("has nothing to say about a kind with no range, or an open estimate", () => {
    expect(inRange(pred({ kind: "risk", resolvedAt: "x", outcome: 1 }))).toBeNull();
    expect(inRange(pred())).toBeNull();
  });
});
