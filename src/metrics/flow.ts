import type { StateTransition, WorkItem, WorkItemId } from "@/domain";

import {
  activeTime,
  firstEntryInto,
  groupByWorkItem,
  lastEntryInto,
  normaliseHistory,
  reopenCount,
  stateIntervals,
  timeInState,
} from "./history";
import {
  available,
  mean,
  median,
  percentile,
  unavailable,
  type MetricResult,
  type Milliseconds,
} from "./result";

/**
 * Flow metrics: how long work takes, and where it waits.
 *
 * Every function here is pure and derives from `StateTransition`, never from
 * `WorkItem.state`. The current state cannot answer "how long did this take" —
 * it only says where things ended up (ADR-0002).
 */

/**
 * Cycle time: from first entry into `in_progress` to first entry into `done`.
 *
 * The glossary definition, applied literally. Both bounds are *first* entries:
 * an item that was reopened and finished again still took, the first time, the
 * time it took. Measuring to the last completion would make reopening look like
 * slower delivery rather than what it is — rework, which `reopenRate` reports
 * separately.
 */
export function cycleTime(
  transitions: readonly StateTransition[],
): MetricResult<Milliseconds> {
  const started = firstEntryInto(transitions, "in_progress");
  const finished = firstEntryInto(transitions, "done");

  if (!started || !finished) return unavailable("no-qualifying-data", 0);

  // An item that reached `done` without ever passing through `in_progress`
  // yields no started instant, so this only guards against a history where
  // completion precedes the start — malformed rather than merely unusual.
  const duration = finished.getTime() - started.getTime();
  if (duration < 0) return unavailable("no-qualifying-data", 0);

  return available(duration, 1);
}

/**
 * Lead time: from creation to first entry into `done`.
 *
 * Longer than cycle time by the time an item waited in the backlog, and that
 * gap is usually the more interesting number: it is what a requester
 * experiences, while cycle time is what the team experiences.
 */
export function leadTime(
  item: WorkItem,
  transitions: readonly StateTransition[],
): MetricResult<Milliseconds> {
  const finished = firstEntryInto(transitions, "done");
  if (!finished) return unavailable("no-qualifying-data", 0);

  const duration = finished.getTime() - item.sourceCreatedAt.getTime();
  if (duration < 0) return unavailable("no-qualifying-data", 0);

  return available(duration, 1);
}

/** Cumulative time spent in `blocked`, across every stretch. */
export function blockedTime(
  transitions: readonly StateTransition[],
  asOf: Date,
): Milliseconds {
  return timeInState(transitions, "blocked", asOf);
}

/**
 * Flow efficiency: active time divided by total elapsed time.
 *
 * A number between 0 and 1 that answers "of the time this item was in flight,
 * how much was it in the workflow rather than stalled".
 *
 * Measured from the first `in_progress`, not from creation: backlog time is not
 * a flow inefficiency, it is a prioritisation decision.
 *
 * **Known limitation, open question Q1 in the glossary.** `in_review` counts as
 * active, because that is what the glossary says when defining WIP. The
 * consequence is that a review bottleneck is invisible here: an item that goes
 * `in_progress` → `in_review` → `done` scores 1 even if it waited four days for
 * someone to look at it. Verified against the synthetic data set, where median
 * efficiency is exactly 1 while review wait climbs from hours to days.
 *
 * Until the Product Owner decides, this metric drops only for work that was
 * `blocked` or pushed back to `todo`. **`reviewWaitTime` is the metric that
 * sees the review bottleneck**, and an interface showing one without the other
 * would mislead.
 */
export function flowEfficiency(
  transitions: readonly StateTransition[],
  asOf: Date,
): MetricResult<number> {
  const started = firstEntryInto(transitions, "in_progress");
  if (!started) return unavailable("no-qualifying-data", 0);

  const finished = firstEntryInto(transitions, "done");
  const end = finished ?? asOf;

  const elapsed = end.getTime() - started.getTime();
  if (elapsed <= 0) return unavailable("empty-denominator", 1);

  const active = stateIntervals(transitions, end)
    .filter((interval) => interval.from.getTime() >= started.getTime())
    .filter((interval) => interval.state === "in_progress" || interval.state === "in_review")
    .reduce((total, interval) => total + interval.duration, 0);

  return available(active / elapsed, 1);
}

/**
 * Aging: how long an unfinished item has been in its current state.
 *
 * Deliberately `null` for finished work. Aging exists to surface items that are
 * stuck *now*; including completed ones would bury the signal under history.
 */
export function agingWorkItem(
  transitions: readonly StateTransition[],
  asOf: Date,
): MetricResult<Milliseconds> {
  const history = normaliseHistory(transitions);
  const last = history[history.length - 1];

  if (!last) return unavailable("no-data", 0);
  if (last.toState === "done" || last.toState === "cancelled") {
    return unavailable("no-qualifying-data", 0);
  }

  return available(Math.max(0, asOf.getTime() - last.occurredAt.getTime()), 1);
}

export type DistributionSummary = {
  readonly mean: MetricResult<Milliseconds>;
  readonly median: MetricResult<Milliseconds>;
  /** The commitment number: "most items finish within this". */
  readonly p85: MetricResult<Milliseconds>;
};

/**
 * Summarises durations three ways rather than picking one.
 *
 * Flow data is skewed: a single item stuck for three weeks drags the mean far
 * from anything the team recognises. Showing mean, median and 85th percentile
 * together makes the skew visible instead of hiding it behind whichever
 * statistic happened to be chosen.
 */
export function summariseDurations(values: readonly Milliseconds[]): DistributionSummary {
  return {
    mean: mean(values),
    median: median(values),
    p85: percentile(values, 85),
  };
}

export type FlowSummary = {
  readonly cycleTime: DistributionSummary;
  readonly leadTime: DistributionSummary;
  /** Items that reached `done`, and so contributed to the distributions. */
  readonly completedCount: number;
  /** Items considered in total, completed or not. */
  readonly consideredCount: number;
  readonly reopenRate: MetricResult<number>;
  readonly flowEfficiency: DistributionSummary;
};

/**
 * Flow metrics over a set of items.
 *
 * Takes items and their transitions rather than reading a database: purity is
 * what lets the whole engine be tested without one (ADR-0002).
 */
export function summariseFlow(
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  asOf: Date,
): FlowSummary {
  const byItem = groupByWorkItem(transitions);

  const cycleTimes: Milliseconds[] = [];
  const leadTimes: Milliseconds[] = [];
  const efficiencies: number[] = [];
  let completed = 0;
  let reopened = 0;

  for (const item of items) {
    const history = byItem.get(item.id as WorkItemId) ?? [];

    const cycle = cycleTime(history);
    if (cycle.available) {
      cycleTimes.push(cycle.value);
      completed += 1;
    }

    const lead = leadTime(item, history);
    if (lead.available) leadTimes.push(lead.value);

    const efficiency = flowEfficiency(history, asOf);
    if (efficiency.available) efficiencies.push(efficiency.value);

    if (reopenCount(history) > 0) reopened += 1;
  }

  return {
    cycleTime: summariseDurations(cycleTimes),
    leadTime: summariseDurations(leadTimes),
    completedCount: completed,
    consideredCount: items.length,
    /**
     * Share of items that came back after being called done.
     *
     * The denominator is completed items, not all items: an item never
     * finished cannot be reopened, and counting it would dilute the rate into
     * meaninglessness.
     */
    reopenRate:
      completed === 0
        ? unavailable("empty-denominator", 0)
        : available(reopened / completed, completed),
    flowEfficiency: {
      mean: mean(efficiencies),
      median: median(efficiencies),
      p85: percentile(efficiencies, 85),
    },
  };
}

/**
 * Time an item waited in `in_review` before moving on.
 *
 * Uses the last stretch in review rather than the total: when review is the
 * bottleneck, the question is how long the current wait is, and summing earlier
 * rounds of review would answer a different one.
 */
export function reviewWaitTime(
  transitions: readonly StateTransition[],
  asOf: Date,
): MetricResult<Milliseconds> {
  const entered = lastEntryInto(transitions, "in_review");
  if (!entered) return unavailable("no-qualifying-data", 0);

  const intervals = stateIntervals(transitions, asOf);
  const stretch = intervals.find(
    (interval) =>
      interval.state === "in_review" && interval.from.getTime() === entered.getTime(),
  );

  if (!stretch) return unavailable("no-qualifying-data", 0);
  return available(stretch.duration, 1);
}

/**
 * Total active time, exposed for callers that need the raw figure.
 */
export function totalActiveTime(
  transitions: readonly StateTransition[],
  asOf: Date,
): Milliseconds {
  return activeTime(transitions, asOf);
}
