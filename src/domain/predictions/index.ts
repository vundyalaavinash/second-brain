import { and, asc, desc, eq, gte, isNotNull, isNull, lte, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import type { PredictionKind, PredictionUnit } from "@/db/enums";
import { predictions, type Prediction } from "@/db/schema";
import { nowIso } from "@/lib/time";
import { brier, calibration, hitRate, type BrierScore, type Calibration, type HitRate } from "./score";

export * from "./score";

export class PredictionError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "PredictionError";
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface EstimateInput {
  kind: "estimate";
  claim: string;
  resolveBy: string;
  unit: PredictionUnit;
  p50Low: number;
  p50High: number;
  p90Low: number;
  p90High: number;
  notes?: string;
  containerId?: number | null;
  taskId?: number | null;
  itemId?: number | null;
}

export interface RiskInput {
  kind: "risk";
  claim: string;
  resolveBy: string;
  probability: number;
  notes?: string;
  containerId?: number | null;
  taskId?: number | null;
  itemId?: number | null;
}

export interface CallInput {
  kind: "call";
  claim: string;
  resolveBy: string;
  notes?: string;
  containerId?: number | null;
  taskId?: number | null;
  itemId?: number | null;
}

export type PredictionInput = EstimateInput | RiskInput | CallInput;

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new PredictionError(`${label} must be a number`);
  return value;
}

/**
 * The four numbers of an estimate, checked against each other rather than one at a time.
 *
 * Both ranges must be the right way round, and the 90% range has to contain the 50% range: a 90%
 * range narrower than the one you called "likely" is not a wider bet, it is a typo, and letting
 * it through would quietly poison the calibration figure the whole log exists to produce.
 * Negative durations are refused outright; zero is allowed, because "already done" is a real
 * answer to how long something will take.
 */
function checkRanges(input: EstimateInput): void {
  const p50Low = finiteNumber(input.p50Low, "The 50% low");
  const p50High = finiteNumber(input.p50High, "The 50% high");
  const p90Low = finiteNumber(input.p90Low, "The 90% low");
  const p90High = finiteNumber(input.p90High, "The 90% high");
  if ([p50Low, p50High, p90Low, p90High].some((n) => n < 0)) throw new PredictionError("An estimate cannot be negative");
  if (p50Low > p50High) throw new PredictionError("The 50% range runs backwards");
  if (p90Low > p90High) throw new PredictionError("The 90% range runs backwards");
  if (p90Low > p50Low || p90High < p50High) throw new PredictionError("The 90% range has to contain the 50% range");
}

/**
 * Log a call. The row is built from the kind rather than from the whole input, so an estimate can
 * never carry a probability and a risk can never carry ranges — the columns each kind does not
 * use stay null, which is what lets the score functions trust what they read.
 */
export function createPrediction(db: DB, input: PredictionInput): Prediction {
  const claim = input.claim.trim();
  if (!claim) throw new PredictionError("A prediction needs a claim");
  if (!DAY.test(input.resolveBy)) throw new PredictionError("A prediction needs a date it resolves by");

  const now = nowIso();
  const base = {
    kind: input.kind,
    claim,
    resolveBy: input.resolveBy,
    notes: input.notes?.trim() ?? "",
    containerId: input.containerId ?? null,
    taskId: input.taskId ?? null,
    itemId: input.itemId ?? null,
    createdAt: now,
    updatedAt: now,
  };

  let values: typeof predictions.$inferInsert;
  if (input.kind === "estimate") {
    checkRanges(input);
    values = { ...base, unit: input.unit, p50Low: input.p50Low, p50High: input.p50High, p90Low: input.p90Low, p90High: input.p90High };
  } else if (input.kind === "risk") {
    const probability = finiteNumber(input.probability, "The probability");
    if (probability < 0 || probability > 1) throw new PredictionError("A probability is between 0 and 1");
    values = { ...base, probability };
  } else {
    values = base;
  }

  const row = db.insert(predictions).values(values).returning().get();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export function getPrediction(db: DB, id: number): Prediction | undefined {
  return db.select().from(predictions).where(eq(predictions.id, id)).get();
}

function requirePrediction(db: DB, id: number): Prediction {
  const row = getPrediction(db, id);
  if (!row) throw new PredictionError("Prediction not found", 404);
  return row;
}

export type PredictionState = "open" | "resolved" | "all";

export interface PredictionFilter {
  kind?: PredictionKind;
  state?: PredictionState;
  /** Inclusive bounds on when the prediction was made, as local days. */
  from?: string;
  to?: string;
}

function conditions(filter: PredictionFilter): SQL[] {
  const where: SQL[] = [];
  if (filter.kind) where.push(eq(predictions.kind, filter.kind));
  if (filter.state === "open") where.push(isNull(predictions.resolvedAt));
  if (filter.state === "resolved") where.push(isNotNull(predictions.resolvedAt));
  // `createdAt` is a full timestamp and the bounds are days, so the upper bound compares against
  // the end of its day rather than its midnight -- otherwise a call made at noon on the last day
  // of a week would fall outside that week.
  if (filter.from) where.push(gte(predictions.createdAt, filter.from));
  if (filter.to) where.push(lte(predictions.createdAt, `${filter.to}T23:59:59.999Z`));
  return where;
}

/** The log, newest first. Open ones first within that, because they are the ones with work left. */
export function listPredictions(db: DB, filter: PredictionFilter = {}): Prediction[] {
  const where = conditions(filter);
  return db
    .select()
    .from(predictions)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(predictions.resolvedAt), desc(predictions.createdAt))
    .all();
}

/**
 * Calls whose answer is already knowable and which nobody has gone back to score, oldest first.
 *
 * This is the engine of the whole thing. A log of predictions nobody resolves is a diary, and
 * the figures it produces are worse than none: they describe only the calls that happened to be
 * fun to come back to. So this is surfaced on Home, where it is seen without being looked for.
 */
export function duePredictions(db: DB, today: string): Prediction[] {
  return db
    .select()
    .from(predictions)
    .where(and(isNull(predictions.resolvedAt), lte(predictions.resolveBy, today)))
    .orderBy(asc(predictions.resolveBy), asc(predictions.id))
    .all();
}

export interface Resolution {
  /** `estimate`: what it actually took, in the prediction's own unit. */
  actual?: number;
  /** `risk` and `call`: whether it happened, or whether the call was right. */
  outcome?: boolean;
}

/**
 * Write down what actually happened. Re-resolving is allowed on purpose — an actual typed into
 * the wrong row is worth correcting, and refusing would leave the only fix as deleting the call,
 * which is exactly the row you least want someone deleting.
 */
export function resolvePrediction(db: DB, id: number, resolution: Resolution): Prediction {
  const row = requirePrediction(db, id);
  const set: Partial<typeof predictions.$inferInsert> = { resolvedAt: nowIso(), updatedAt: nowIso() };

  if (row.kind === "estimate") {
    const actual = finiteNumber(resolution.actual, "The actual");
    if (actual < 0) throw new PredictionError("An actual cannot be negative");
    set.actual = actual;
  } else {
    if (typeof resolution.outcome !== "boolean") throw new PredictionError("Say whether it happened");
    set.outcome = resolution.outcome ? 1 : 0;
  }

  const updated = db.update(predictions).set(set).where(eq(predictions.id, id)).returning().get();
  if (!updated) throw new Error("Update returned no row");
  return updated;
}

/** Put a resolved call back to open, losing what was written as its answer. */
export function unresolvePrediction(db: DB, id: number): Prediction {
  requirePrediction(db, id);
  const updated = db
    .update(predictions)
    .set({ resolvedAt: null, actual: null, outcome: null, updatedAt: nowIso() })
    .where(eq(predictions.id, id))
    .returning()
    .get();
  if (!updated) throw new Error("Update returned no row");
  return updated;
}

/**
 * Edit the claim, its date, its notes or its links. The stated prediction itself — the ranges and
 * the probability — is deliberately not editable: changing the number after the fact is the one
 * thing that would make every score in this module meaningless. Fix a mistyped range by deleting
 * the row and logging it again, before the answer is in.
 */
export function updatePrediction(
  db: DB,
  id: number,
  patch: { claim?: string; resolveBy?: string; notes?: string; containerId?: number | null; taskId?: number | null; itemId?: number | null },
): Prediction {
  requirePrediction(db, id);
  const set: Partial<typeof predictions.$inferInsert> = {};
  if (patch.claim !== undefined) {
    const claim = patch.claim.trim();
    if (!claim) throw new PredictionError("A prediction needs a claim");
    set.claim = claim;
  }
  if (patch.resolveBy !== undefined) {
    if (!DAY.test(patch.resolveBy)) throw new PredictionError("A prediction needs a date it resolves by");
    set.resolveBy = patch.resolveBy;
  }
  if (patch.notes !== undefined) set.notes = patch.notes.trim();
  if (patch.containerId !== undefined) set.containerId = patch.containerId;
  if (patch.taskId !== undefined) set.taskId = patch.taskId;
  if (patch.itemId !== undefined) set.itemId = patch.itemId;
  if (Object.keys(set).length === 0) return requirePrediction(db, id);

  set.updatedAt = nowIso();
  const updated = db.update(predictions).set(set).where(eq(predictions.id, id)).returning().get();
  if (!updated) throw new Error("Update returned no row");
  return updated;
}

export function deletePrediction(db: DB, id: number): void {
  requirePrediction(db, id);
  db.delete(predictions).where(eq(predictions.id, id)).run();
}

export interface PredictionScores {
  estimate: Calibration & { logged: number };
  risk: BrierScore & { logged: number };
  call: HitRate & { logged: number };
}

/**
 * The three numbers, over a window if one is given and over everything otherwise.
 *
 * `logged` counts every call of that kind in the window, resolved or not, because "I made 20
 * estimates this quarter" is itself one of the things worth knowing — several of the plan's own
 * targets are counts of reps rather than scores. A row is only fed to the score functions once
 * its payload is actually there, so a resolved row somehow missing its actual cannot drag a
 * figure toward zero.
 */
export function predictionScores(db: DB, window: { from?: string; to?: string } = {}): PredictionScores {
  const rows = listPredictions(db, { ...window, state: "all" });
  const of = (kind: PredictionKind) => rows.filter((r) => r.kind === kind);

  const estimates = of("estimate");
  const risks = of("risk");
  const calls = of("call");

  return {
    estimate: {
      logged: estimates.length,
      ...calibration(
        estimates
          .filter((r) => r.resolvedAt !== null && r.actual !== null && r.p90Low !== null && r.p90High !== null)
          .map((r) => ({ p90Low: r.p90Low!, p90High: r.p90High!, actual: r.actual! })),
      ),
    },
    risk: {
      logged: risks.length,
      ...brier(
        risks
          .filter((r) => r.resolvedAt !== null && r.outcome !== null && r.probability !== null)
          .map((r) => ({ probability: r.probability!, outcome: r.outcome! })),
      ),
    },
    call: {
      logged: calls.length,
      ...hitRate(calls.filter((r) => r.resolvedAt !== null && r.outcome !== null).map((r) => ({ outcome: r.outcome! }))),
    },
  };
}
