/** How many finished tasks the figure looks back over. Enough to be stable, recent enough to
 * follow a person as they change. */
export const DRIFT_WINDOW = 30;
/** Below this many pairs there is no figure at all. A multiplier built from three data points
 * is exactly the false confidence this feature exists to remove (spec §4.1). */
export const DRIFT_MIN_PAIRS = 8;
/** Outside this range the number is a bug in the data, not a fact about the person. */
export const DRIFT_FLOOR = 0.5;
export const DRIFT_CEILING = 4.0;

export interface Pair {
  estimateMinutes: number;
  actualMinutes: number;
}

/**
 * How long this person's work actually takes against what they guessed, as one multiplier.
 * The median rather than the mean: one task that ran six times over says something about that
 * task, not about the next estimate.
 */
export function driftFactor(pairs: Pair[]): number | null {
  const ratios = pairs
    .slice(0, DRIFT_WINDOW)
    .filter((p) => p.estimateMinutes > 0 && p.actualMinutes >= 0)
    .map((p) => p.actualMinutes / p.estimateMinutes)
    .sort((a, b) => a - b);
  if (ratios.length < DRIFT_MIN_PAIRS) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Math.min(DRIFT_CEILING, Math.max(DRIFT_FLOOR, median));
}

/** What a plan of `planned` estimated minutes is likely to actually cost. */
export function forecastMinutes(planned: number, drift: number | null): number | null {
  return drift === null ? null : Math.round(planned * drift);
}
