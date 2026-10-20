import type { PredictionKind } from "@/db/enums";

/**
 * How a log of calls scores itself. Pure arithmetic over the smallest shape each kind needs, not
 * over database rows: the three numbers here are the ones a person is actually trying to move,
 * so they are worth testing without a database in the way.
 *
 * Every function returns `null` for its percentage or score when nothing has resolved yet. Zero
 * would be a lie — it reads as "you are terrible at this" when the truth is "you have not
 * finished anything yet" — and the surfaces that show these treat null as "not yet".
 */

/** Share of actuals that must land inside the 90% range before calibration is honest. */
export const CALIBRATION_TARGET = 85;
/** Brier at or under this beats a careful forecaster; 0.25 is a coin flip. */
export const BRIER_TARGET = 0.2;
/** Share of bare calls that should be right. */
export const HIT_RATE_TARGET = 70;

export interface ResolvedEstimate {
  p90Low: number;
  p90High: number;
  actual: number;
}

export interface ResolvedRisk {
  probability: number;
  /** 1 if it happened, 0 if it did not. */
  outcome: number;
}

export interface ResolvedCall {
  outcome: number;
}

export interface Calibration {
  resolved: number;
  inRange: number;
  /** Percent of actuals inside the 90% range, rounded; null until one has resolved. */
  percent: number | null;
}

/**
 * Whether the actuals land inside the ranges as often as a 90% range claims they should.
 *
 * The bound is inclusive: an actual exactly on the edge of a range you gave was inside the range
 * you gave. A range stored the wrong way round (high below low) is not treated as empty — the
 * bounds are compared after ordering, because the person's intent was a range either way and
 * silently scoring every such row as a miss would flatter nobody.
 */
export function calibration(rows: ResolvedEstimate[]): Calibration {
  let inRange = 0;
  for (const r of rows) {
    const low = Math.min(r.p90Low, r.p90High);
    const high = Math.max(r.p90Low, r.p90High);
    if (r.actual >= low && r.actual <= high) inRange += 1;
  }
  return {
    resolved: rows.length,
    inRange,
    percent: rows.length === 0 ? null : Math.round((inRange / rows.length) * 100),
  };
}

export interface BrierScore {
  resolved: number;
  /** Mean (probability − outcome)², to three decimals; null until one has resolved. */
  score: number | null;
}

/**
 * The Brier score of a set of risk calls: the mean squared distance between what you said was
 * going to happen and what did. Lower is better, 0.25 is what saying "50%" to everything earns,
 * and the only way to beat it is to be both confident and right.
 */
export function brier(rows: ResolvedRisk[]): BrierScore {
  if (rows.length === 0) return { resolved: 0, score: null };
  const total = rows.reduce((sum, r) => sum + (r.probability - r.outcome) ** 2, 0);
  // Rounded for display, and rounded here rather than at each surface so the number under the
  // 0.20 target is the same number everywhere it is compared against it.
  return { resolved: rows.length, score: Math.round((total / rows.length) * 1000) / 1000 };
}

export interface HitRate {
  resolved: number;
  hit: number;
  percent: number | null;
}

/** Share of bare calls that turned out right. */
export function hitRate(rows: ResolvedCall[]): HitRate {
  const hit = rows.reduce((n, r) => n + (r.outcome === 1 ? 1 : 0), 0);
  return { resolved: rows.length, hit, percent: rows.length === 0 ? null : Math.round((hit / rows.length) * 100) };
}

/** Whether a kind's score is at or past its target. Null reads as "not yet", never as a pass. */
export function meetsTarget(kind: PredictionKind, value: number | null): boolean {
  if (value === null) return false;
  if (kind === "estimate") return value >= CALIBRATION_TARGET;
  if (kind === "risk") return value <= BRIER_TARGET;
  return value >= HIT_RATE_TARGET;
}
