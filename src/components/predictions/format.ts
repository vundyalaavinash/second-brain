import type { PredictionDTO } from "@/lib/dto";

/** The four kinds of number the log holds, each written the way it was called. */
export function statedAs(p: PredictionDTO): string {
  if (p.kind === "estimate") {
    if (p.p50Low === null || p.p50High === null || p.p90Low === null || p.p90High === null) return "";
    return `${range(p.p50Low, p.p50High)} likely, ${range(p.p90Low, p.p90High)} at 90%${p.unit ? ` ${p.unit}` : ""}`;
  }
  if (p.kind === "risk") return p.probability === null ? "" : `${Math.round(p.probability * 100)}%`;
  return "";
}

/** `4` rather than `4–4`: a range of one number is a number. */
function range(low: number, high: number): string {
  return low === high ? trim(low) : `${trim(low)}–${trim(high)}`;
}

/** No trailing `.0` on a whole number of days. */
function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** What actually happened, once it is known. Empty while the call is still open. */
export function resolvedAs(p: PredictionDTO): string {
  if (p.resolvedAt === null) return "";
  if (p.kind === "estimate") return p.actual === null ? "" : `took ${trim(p.actual)}${p.unit ? ` ${p.unit}` : ""}`;
  if (p.kind === "risk") return p.outcome === 1 ? "it happened" : "it did not happen";
  return p.outcome === 1 ? "right" : "wrong";
}

/**
 * Whether a resolved estimate landed inside the 90% range it was given.
 *
 * Null for anything that is not a resolved estimate, and null is not "no" — the row reads it as
 * "nothing to say" rather than painting a miss on a risk call that has no range at all.
 */
export function inRange(p: PredictionDTO): boolean | null {
  if (p.kind !== "estimate" || p.resolvedAt === null || p.actual === null || p.p90Low === null || p.p90High === null) return null;
  return p.actual >= Math.min(p.p90Low, p.p90High) && p.actual <= Math.max(p.p90Low, p.p90High);
}
