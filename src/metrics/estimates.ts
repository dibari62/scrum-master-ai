import {
  estimateAt,
  groupEstimateChanges,
  type Estimate,
  type EstimateChange,
  type WorkItem,
} from "@/domain";

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

/**
 * Which estimate of an item a calculation should use.
 *
 * **Why a function and not a field.** «The estimate» is ambiguous once time is
 * involved, and the ambiguity is exactly what produced the defect this type
 * fixes. Kniberg: «the actual velocity is based on the **initial** estimates of
 * each story. Any updates to the story time estimates done during the sprint
 * are ignored» (pag. 29). Velocity wants the estimate as it was when the item
 * entered the sprint; a burndown point wants it as it was on that day; a list
 * on screen wants it as it is now. Three different questions, one field.
 *
 * Making the choice a parameter forces every call site to say which one it
 * means, instead of silently getting "now".
 */
export type EstimateResolver = (item: WorkItem) => Estimate | null;

/**
 * The estimate as it stands today.
 *
 * Right for anything describing the present — a board, a backlog, a detail
 * page. Wrong for anything describing a closed period, which is why it is not
 * the default anywhere a past instant is available.
 */
export const currentEstimate: EstimateResolver = (item) => item.estimate;

/**
 * The estimate as it stood at a given instant, per item.
 *
 * `instantFor` is a function of the item rather than one date because the
 * instant that matters is not always shared. For velocity it is the moment each
 * item **entered the sprint**, which differs for anything pulled in mid-sprint:
 * before it entered there was no plan to honour, so its "initial" estimate is
 * the one it carried on arrival.
 *
 * **Items with no recorded history fall back to their current estimate**, and
 * that is a stated behaviour rather than an oversight. A source that only
 * exposes the current value gives us exactly one observation, and treating it
 * as "it was always this" is the only reading available. What it cannot do is
 * hide a re-estimate — because a re-estimate the source never recorded is not
 * something any calculation could have known about.
 */
export function estimateAsOf(
  changes: readonly EstimateChange[],
  instantFor: (item: WorkItem) => Date,
): EstimateResolver {
  const byItem = groupEstimateChanges(changes);

  return (item) => {
    const history = byItem.get(item.id);
    if (!history || history.length === 0) return item.estimate;

    return estimateAt(history, instantFor(item));
  };
}

/** `estimateAsOf` when every item is read at the same instant. */
export function estimateAtInstant(
  changes: readonly EstimateChange[],
  instant: Date,
): EstimateResolver {
  return estimateAsOf(changes, () => instant);
}

/**
 * Sums estimates, keeping each unit apart.
 *
 * The resolver defaults to the current estimate so that call sites describing
 * the present stay unchanged. Anything describing a closed period must pass one
 * explicitly — see `EstimateResolver`.
 */
export function totalEstimates(
  items: readonly WorkItem[],
  resolve: EstimateResolver = currentEstimate,
): EstimateTotals {
  let points: number | null = null;
  let hours: number | null = null;
  let unestimated = 0;

  for (const item of items) {
    const estimate: Estimate | null = resolve(item);

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
