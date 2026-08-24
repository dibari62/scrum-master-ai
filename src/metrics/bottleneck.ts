import { isValueAdding, type StateTransition, type WorkItemState } from "@/domain";

import { firstEntryInto, groupByWorkItem, stateIntervals } from "./history";
import {
  available,
  median,
  unavailable,
  type MetricResult,
  type Milliseconds,
} from "./result";

/**
 * Where the time goes, phase by phase.
 *
 * **What this adds to what already existed.** Flow efficiency says how much of
 * an item's life was work rather than queue — on this project's data, 23%. That
 * number tells a team it is waiting and not where. The answer to "review is
 * congested" is nothing like the answer to "work sits blocked on an external
 * supplier", so a diagnosis that stops at "you are waiting" leaves the reader
 * to do the remaining work by hand.
 *
 * **The measurement starts at the first `in_progress`** (open question Q1,
 * decided). Time in the backlog is waiting too, but it is waiting *before* the
 * team took the work on: a prioritisation decision, not a jam in the flow.
 * Counting it would make "da fare" the bottleneck of nearly every project —
 * true, and useless. It also keeps this metric measuring the same stretch of
 * time as flow efficiency, so the two figures can be read against each other.
 *
 * Pure and I/O-free, and it never reads the clock (ADR-0002).
 */

export type FlowStage = {
  readonly state: WorkItemState;
  /** Total time every item spent in this state, added up. */
  readonly totalMs: Milliseconds;
  /** This stage's share of all the time measured, between 0 and 1. */
  readonly share: number;
  /**
   * The middle duration of a single stay.
   *
   * Per stay and not per item: an item that goes back to review three times
   * contributes three stays, and averaging them into one would hide the
   * repetition that made the phase expensive.
   */
  readonly medianMs: MetricResult<Milliseconds>;
  /** How many distinct items passed through it. */
  readonly itemCount: number;
  /** Whether somebody is working during it, as the domain defines it. */
  readonly valueAdding: boolean;
};

export type Bottleneck = {
  /** Every observed stage, most time-consuming first. */
  readonly stages: readonly FlowStage[];
  /**
   * The waiting stage that absorbs the most time, or `null`.
   *
   * `null` when nothing waited: naming a bottleneck anyway would promote the
   * least bad thing to a problem. Chosen only among waiting stages, because
   * calling the work itself a bottleneck would be telling a team that the
   * obstacle to finishing is doing the job.
   *
   * No threshold decides whether it "counts" as a bottleneck (open question
   * Q2): the share travels with the name so the reader can judge, rather than
   * having the doubt hidden behind a number nobody has calibrated.
   */
  readonly worstWait: FlowStage | null;
  /** Share of all measured time in which somebody was working. */
  readonly valueAddingShare: number;
};

/**
 * Splits the measured time by phase.
 *
 * Unavailable — rather than a set of zeroes — when no item ever reached
 * `in_progress`: "nothing was ever started" and "everything was instant" are
 * different statements, and a screen showing 0% everywhere would merge them.
 */
export function bottleneck(
  transitions: readonly StateTransition[],
  asOf: Date,
): MetricResult<Bottleneck> {
  const byItem = groupByWorkItem(transitions);
  if (byItem.size === 0) return unavailable("no-data", 0);

  /** Every stay in a state, kept per state so the median has a sample. */
  const staysByState = new Map<WorkItemState, Milliseconds[]>();
  const itemsByState = new Map<WorkItemState, Set<string>>();

  let considered = 0;

  for (const [itemId, history] of byItem) {
    const started = firstEntryInto(history, "in_progress");
    // Never taken on: there is no flow to measure, only a queue this metric
    // deliberately leaves out.
    if (!started) continue;

    considered += 1;

    /*
     * The measurement ends at the first completion, not at the reference
     * instant.
     *
     * `stateIntervals` keeps the last state open until `asOf`, so a finished
     * item would contribute weeks of "time in done" — and `done` would win
     * every project by a distance. Time after the work ended is not flow time;
     * it is time the item spent existing.
     *
     * The first completion rather than the last, exactly as cycle time does, so
     * the two measure the same stretch.
     */
    const finished = firstEntryInto(history, "done");
    const end = finished ?? asOf;
    if (end.getTime() <= started.getTime()) continue;

    for (const interval of stateIntervals(history, end)) {
      // Strictly from the moment work began. A stay that started earlier is
      // backlog time, and Q1 puts that outside the measurement.
      if (interval.from.getTime() < started.getTime()) continue;
      if (interval.duration <= 0) continue;

      // Terminal states are where an item stops, not a phase it passes
      // through: counting them would measure how long ago it finished.
      if (interval.state === "done" || interval.state === "cancelled") continue;

      const stays = staysByState.get(interval.state) ?? [];
      stays.push(interval.duration);
      staysByState.set(interval.state, stays);

      const items = itemsByState.get(interval.state) ?? new Set<string>();
      items.add(itemId);
      itemsByState.set(interval.state, items);
    }
  }

  if (considered === 0) return unavailable("no-qualifying-data", 0);

  const total = [...staysByState.values()]
    .flat()
    .reduce((sum, duration) => sum + duration, 0);

  // Everything measured lasted no time at all: a share of each would be a
  // division by zero dressed up as a percentage.
  if (total <= 0) return unavailable("empty-denominator", considered);

  const stages: FlowStage[] = [...staysByState.entries()]
    .map(([state, stays]) => {
      const totalMs = stays.reduce((sum, duration) => sum + duration, 0);

      return {
        state,
        totalMs,
        share: totalMs / total,
        medianMs: median(stays),
        itemCount: itemsByState.get(state)?.size ?? 0,
        valueAdding: isValueAdding(state),
      };
    })
    .sort((a, b) => b.totalMs - a.totalMs);

  const waits = stages.filter((stage) => !stage.valueAdding);

  const valueAddingShare = stages
    .filter((stage) => stage.valueAdding)
    .reduce((sum, stage) => sum + stage.share, 0);

  return available(
    { stages, worstWait: waits[0] ?? null, valueAddingShare },
    considered,
  );
}
