import type { ImprovementAction, Retrospective } from "@/domain";

import {
  available,
  mean,
  unavailable,
  type MetricResult,
  type Milliseconds,
} from "./result";

/**
 * Did the retrospective change anything?
 *
 * **The only question worth asking about a retrospective, and the reason the
 * entity exists.** «Focus on just a few improvements per sprint» (pag. 87) is
 * advice that means nothing unless somebody later checks whether those few
 * happened. A product that recorded retrospectives and never looked back at
 * them would be a nicer way of forgetting.
 *
 * Deterministic like everything in this folder: these are counts and elapsed
 * time, not judgements. Nothing here decides whether an improvement was a good
 * idea — only whether it was still open, and for how long.
 *
 * **No individual anywhere.** Improvements belong to retrospectives, not to
 * people, and there is deliberately no way to ask who proposed one or who
 * closed it (§8.2).
 */

export type ImprovementFollowUp = {
  readonly openCount: number;
  readonly doneCount: number;
  readonly droppedCount: number;

  /**
   * Improvements decided, minus those explicitly dropped.
   *
   * The denominator of the completion share. Dropped ones are excluded because
   * the book treats deciding *not* to act as a legitimate outcome — «in many
   * cases, just identifying a problem clearly is enough for it to solve itself»
   * (pag. 88) — and counting them as failures would push a team to claim
   * completion instead of admitting a change was not needed.
   */
  readonly consideredCount: number;

  /**
   * Share of considered improvements that were carried out, 0 to 1.
   *
   * `null` when nothing was considered: a team that dropped everything it
   * decided has no completion rate, and reporting `0` would read as a team that
   * tried and failed.
   */
  readonly completionShare: number | null;

  /**
   * The longest an improvement has been open at `asOf`, in milliseconds.
   *
   * `null` when none is open. Milliseconds like every other duration in this
   * engine: converting to days here would be rounding, and the metrics
   * instructions put rounding at the presentation layer.
   *
   * This is the figure that makes the follow-up uncomfortable in the useful
   * way: an improvement open for four sprints is not a plan, it is a wish.
   */
  readonly longestOpenMs: Milliseconds | null;
};

/**
 * How the improvements a project decided have actually gone.
 *
 * `asOf` arrives as a parameter, never from the clock (ADR-0002): "open for
 * eleven days" is a statement about an instant, and a function that read the
 * clock would answer differently on every run and be untestable.
 */
export function improvementFollowUp(
  actions: readonly ImprovementAction[],
  asOf: Date,
): MetricResult<ImprovementFollowUp> {
  if (actions.length === 0) return unavailable("no-data", 0);

  const open = actions.filter((action) => action.status === "open");
  const done = actions.filter((action) => action.status === "done");
  const dropped = actions.filter((action) => action.status === "dropped");

  const considered = done.length + open.length;

  const openDays = open.map((action) => asOf.getTime() - action.createdAt.getTime());

  return available(
    {
      openCount: open.length,
      doneCount: done.length,
      droppedCount: dropped.length,
      consideredCount: considered,
      completionShare: considered === 0 ? null : done.length / considered,
      longestOpenMs: openDays.length === 0 ? null : Math.max(...openDays),
    },
    actions.length,
  );
}

/**
 * How long a closed improvement took, in milliseconds.
 *
 * Only the resolved ones: an open improvement has no duration yet, and giving
 * it "time so far" would mix two different measurements into one average —
 * making a team look faster the more improvements it leaves open.
 */
export function improvementLeadTime(
  actions: readonly ImprovementAction[],
): MetricResult<Milliseconds> {
  const durations = actions
    .filter((action) => action.resolvedAt !== null)
    .map((action) => (action.resolvedAt as Date).getTime() - action.createdAt.getTime())
    // Un'azione risolta prima di essere decisa è un difetto della fonte, non
    // una durata negativa da mediare.
    .filter((span) => span >= 0);

  if (durations.length === 0) return unavailable("no-qualifying-data", actions.length);

  return mean(durations);
}

/**
 * How many improvements a retrospective decided, ordered by votes.
 *
 * The order is the wall's order: the book uses dot voting precisely to put the
 * few that matter at the top. Ties keep their original order, so a repeated
 * read gives the same list — a table that reshuffles between two refreshes
 * teaches the reader that the order means nothing.
 *
 * **Votes are not returned here.** Whether they may be shown at all depends on
 * how many people were in the room (`mayShowVotes`), which is a property of the
 * retrospective, not of the calculation. This function orders; the caller
 * decides what to reveal.
 */
export function improvementsByPriority(
  actions: readonly ImprovementAction[],
  retrospective: Retrospective,
): readonly ImprovementAction[] {
  return actions
    .filter((action) => action.retrospectiveId === retrospective.id)
    .map((action, index) => ({ action, index }))
    .sort((a, b) => b.action.votes - a.action.votes || a.index - b.index)
    .map((entry) => entry.action);
}
