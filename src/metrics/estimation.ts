import {
  isOnScale,
  neighboursOnScale,
  type EstimationScale,
  type WorkItem,
  type WorkItemId,
} from "@/domain";

/**
 * Conformance of the estimates to the scale the project declared.
 *
 * > «you can't cheat by combining a 5 and a 2 to make a 7. You have to choose
 * > either 5 or 8; there is **no 7**» (pag. 38)
 *
 * The gaps in the deck are the whole point: they stop a team from claiming a
 * precision it does not have. A scale that nobody checks is a scale nobody
 * follows, so the portal counts the deviations.
 *
 * **It reports, it does not reject.** Estimates arrive from an ingested source,
 * and ingested content is data (R3): refusing to import a Jira story sized 7
 * would lose the story, not fix the estimate. Rejection belongs where a human
 * types a number into *our* interface — `isOnScale` is there for that day.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock.
 */

/** One estimate that the declared scale does not admit. */
export interface OffScaleEstimate {
  readonly itemId: WorkItemId;
  readonly title: string;
  readonly value: number;

  /**
   * The two admitted values it sits between, the way the book refuses a 7 —
   * "you have to choose either 5 or 8".
   *
   * `null` above the largest card: beyond 100 there is no upper neighbour to
   * name, and inventing one would be worse than saying nothing.
   */
  readonly neighbours: { readonly below: number; readonly above: number } | null;
}

export interface EstimationScaleConformance {
  readonly scale: EstimationScale;

  /**
   * How many estimates the scale was able to judge.
   *
   * Not the number of work items: an unestimated item and one sized in hours
   * are both outside the question, and counting them would make the ratio of
   * deviations depend on how many spikes the sprint happened to contain.
   */
  readonly considered: number;

  readonly offScale: readonly OffScaleEstimate[];
}

/**
 * Which estimates fall outside the declared scale.
 *
 * With no scale declared — `free` — nothing is considered and nothing is
 * reported. That is not the engine giving up: a project that never chose a deck
 * has no deviations to show, and reporting some would be inventing a rule the
 * team never adopted.
 *
 * Order follows the input, so the same data always produces the same list: a
 * report whose rows move between two runs looks like a change when it is not.
 */
export function estimationScaleConformance(
  items: readonly WorkItem[],
  scale: EstimationScale,
): EstimationScaleConformance {
  if (scale === "free") return { scale, considered: 0, offScale: [] };

  const offScale: OffScaleEstimate[] = [];
  let considered = 0;

  for (const item of items) {
    const { estimate } = item;

    // Only points: "3 hours" is a duration, and the deck's gaps carry no
    // meaning there — the same restriction ADR-0008 puts on the focus factor.
    if (estimate === null || estimate.unit !== "points") continue;

    considered += 1;
    if (isOnScale(scale, estimate)) continue;

    offScale.push({
      itemId: item.id,
      title: item.title,
      value: estimate.value,
      neighbours: neighboursOnScale(scale, estimate.value),
    });
  }

  return { scale, considered, offScale };
}
