import type { Estimate, WorkItem } from "@/domain";

/**
 * Summing estimates without lying about them.
 *
 * The metrics instructions are categorical: estimates in different units must
 * never be added together. A team estimating in points and one estimating in
 * hours produce numbers with no common meaning, and `13` from summing `8 points`
 * and `5 hours` is not a smaller error than a wrong calculation — it is a number
 * that looks right and means nothing.
 *
 * So the total is kept **split by unit**, always. The caller cannot accidentally
 * collapse it, because there is no single number to collapse.
 */

export type EstimateTotals = {
  /** `null` when no item in the set was estimated in this unit. */
  readonly points: number | null;
  readonly hours: number | null;

  /** Items with no estimate at all. Not an error: many teams do not estimate everything. */
  readonly unestimatedCount: number;

  /** Items that carried an estimate, whatever the unit. */
  readonly estimatedCount: number;

  /**
   * True when both units appear.
   *
   * The flag exists so the interface can say so out loud. A chart showing
   * "velocity: 21" over a set where half the work was measured in hours is
   * misleading even when both figures are individually correct.
   */
  readonly mixed: boolean;
};

export const EMPTY_TOTALS: EstimateTotals = {
  points: null,
  hours: null,
  unestimatedCount: 0,
  estimatedCount: 0,
  mixed: false,
};

function add(current: number | null, value: number): number {
  return (current ?? 0) + value;
}

/** Sums estimates, keeping each unit apart. */
export function totalEstimates(items: readonly WorkItem[]): EstimateTotals {
  let points: number | null = null;
  let hours: number | null = null;
  let unestimated = 0;

  for (const item of items) {
    const estimate: Estimate | null = item.estimate;

    if (!estimate) {
      unestimated += 1;
      continue;
    }

    if (estimate.unit === "points") points = add(points, estimate.value);
    else hours = add(hours, estimate.value);
  }

  return {
    points,
    hours,
    unestimatedCount: unestimated,
    estimatedCount: items.length - unestimated,
    mixed: points !== null && hours !== null,
  };
}

/**
 * True when the totals describe nothing measurable.
 *
 * Distinct from "zero work": a set of ten unestimated items has no total, while
 * a set of ten items each estimated at zero has a total of zero. Collapsing the
 * two would hide a team that has stopped estimating.
 */
export function hasNoEstimates(totals: EstimateTotals): boolean {
  return totals.points === null && totals.hours === null;
}
