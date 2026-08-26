import type { WorkItem } from "@/domain";

import { totalEstimates, type EstimateTotals } from "./estimates";

/**
 * The release plan: the backlog cut into sprints.
 *
 * > «Each sprint includes **as many stories as possible without exceeding** the
 * > estimated velocity of 45.» (pag. 100)
 *
 * That one sentence is the whole algorithm, and its two halves both matter.
 * *As many as possible* means the list is walked in order and never reordered
 * to pack a sprint better: the order is the Product Owner's decision, and a
 * planner that improved on it would quietly re-prioritise the release. *Without
 * exceeding* means a story that does not fit starts the next sprint rather than
 * being split.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock.
 */

export interface PlannedSprint {
  /** Position in the plan, starting at 1 — this is how a plan is read aloud. */
  readonly number: number;

  readonly items: readonly WorkItem[];

  /** Points committed to this sprint. Never above the velocity unless `overflows`. */
  readonly points: number;

  /**
   * Whether this sprint is over the estimated velocity.
   *
   * True only in one case: a single story larger than a whole sprint. The book
   * does not cover it, and the alternatives are worse — skipping the story
   * would make the delivery date look nearer than it is, and looping forever
   * looking for a fit would be a defect. A sprint that visibly overflows says
   * the true thing: **this story has to be split before it can be planned**.
   */
  readonly overflows: boolean;
}

export interface ReleasePlan {
  readonly sprints: readonly PlannedSprint[];

  /**
   * Items that could not be placed, in backlog order.
   *
   * Today this means "not estimated", and it is the normal state of a backlog
   * tail — the book says so: «Time-estimate the **most important** items». In
   * its own example the last two rows carry no estimate at all.
   *
   * They are reported rather than dropped, and never counted as zero: a
   * zero-point story is free, and an unestimated one is unknown. Treating the
   * second as the first is how a plan comes to promise work nobody has sized.
   */
  readonly unplannable: readonly WorkItem[];

  /** The velocity the plan was cut with, echoed back so a reader can check it. */
  readonly velocity: number;
}

/**
 * Cuts an **already ordered** backlog into sprints.
 *
 * `estimatedVelocity` must be a positive number of points. Zero or less has no
 * meaning here — no sprint could ever hold anything — and returning an empty
 * plan would be indistinguishable from an empty backlog.
 *
 * Only estimates in **points** are planned. A backlog sized in hours is not
 * wrong, but a velocity in points cannot cut it, and mixing the two would
 * produce a plan whose totals mean nothing (`EstimateTotals`).
 */
export function releasePlan(
  orderedBacklog: readonly WorkItem[],
  estimatedVelocity: number,
): ReleasePlan {
  if (!Number.isFinite(estimatedVelocity) || estimatedVelocity <= 0) {
    return { sprints: [], unplannable: [...orderedBacklog], velocity: estimatedVelocity };
  }

  const sprints: PlannedSprint[] = [];
  const unplannable: WorkItem[] = [];

  let current: WorkItem[] = [];
  let currentPoints = 0;

  const close = (overflows: boolean): void => {
    if (current.length === 0) return;

    sprints.push({
      number: sprints.length + 1,
      items: current,
      points: currentPoints,
      overflows,
    });

    current = [];
    currentPoints = 0;
  };

  for (const entry of orderedBacklog) {
    const { estimate } = entry;

    if (estimate === null || estimate.unit !== "points") {
      unplannable.push(entry);
      continue;
    }

    /*
     * Una storia più grande di uno sprint intero.
     *
     * Va in uno sprint tutto suo, dichiarato in sfondamento. Il libro non
     * copre il caso, e le alternative sono peggiori: saltarla farebbe sembrare
     * la consegna più vicina di quanto sia, e cercarle un posto all'infinito
     * sarebbe un difetto. Uno sprint che sfora dice la cosa vera — quella
     * storia va spezzata prima di poter essere pianificata.
     */
    if (estimate.value > estimatedVelocity) {
      close(false);
      current = [entry];
      currentPoints = estimate.value;
      close(true);
      continue;
    }

    // «Without exceeding»: ciò che non entra apre lo sprint successivo, non
    // viene spezzato.
    if (currentPoints + estimate.value > estimatedVelocity) close(false);

    current.push(entry);
    currentPoints += estimate.value;
  }

  close(false);

  return { sprints, unplannable, velocity: estimatedVelocity };
}

/**
 * The range variant: what is certain, what is likely, what is out.
 *
 * > «Estimate velocity as a **range** (30-50 points). Then split the backlog
 * > into three lists: **All**: These stories will all be done, even if our
 * > velocity is low (30). **Some**: Some of these stories will be done, but not
 * > all. **None**: None of these stories will be done, even if our velocity is
 * > high (50).» (pag. 101)
 *
 * It is the same cut run twice, and that is the point: the pessimistic plan
 * says what is safe to promise, the optimistic one says where the promise ends.
 * What sits between the two is honest uncertainty, and naming it is more useful
 * than picking a single number and pretending.
 */
export interface RangeForecastList {
  readonly items: readonly WorkItem[];
  readonly total: EstimateTotals;
}

export interface RangeForecast {
  /** Delivered even at the low end of the range. */
  readonly all: RangeForecastList;
  /** Delivered only if velocity runs high: some of these, not all. */
  readonly some: RangeForecastList;
  /** Out of reach even at the high end. */
  readonly none: RangeForecastList;

  readonly low: number;
  readonly high: number;

  /** How many sprints the range is cut over. */
  readonly sprints: number;
}

/**
 * Splits a backlog into All / Some / None over a number of sprints.
 *
 * The bounds are sorted rather than trusted: a caller that passes them the
 * wrong way round means "between these two", and refusing would be pedantry
 * about an unambiguous intent. Unestimated items fall into `none`, because
 * nothing that has not been sized can be promised.
 */
export function rangeForecast(
  orderedBacklog: readonly WorkItem[],
  bounds: { readonly low: number; readonly high: number },
  sprints: number,
): RangeForecast {
  const low = Math.min(bounds.low, bounds.high);
  const high = Math.max(bounds.low, bounds.high);

  const take = (velocity: number): readonly WorkItem[] => {
    const plan = releasePlan(orderedBacklog, velocity);
    return plan.sprints.slice(0, Math.max(0, Math.trunc(sprints))).flatMap((s) => s.items);
  };

  const certain = new Set(take(low).map((entry) => entry.id));
  const optimistic = new Set(take(high).map((entry) => entry.id));

  const all = orderedBacklog.filter((entry) => certain.has(entry.id));
  const some = orderedBacklog.filter(
    (entry) => optimistic.has(entry.id) && !certain.has(entry.id),
  );
  const none = orderedBacklog.filter((entry) => !optimistic.has(entry.id));

  return {
    all: { items: all, total: totalEstimates(all) },
    some: { items: some, total: totalEstimates(some) },
    none: { items: none, total: totalEstimates(none) },
    low,
    high,
    sprints,
  };
}
