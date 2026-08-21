import {
  compareTransitions,
  isActiveState,
  type StateTransition,
  type WorkItemId,
  type WorkItemState,
} from "@/domain";

import type { Milliseconds } from "./result";

/**
 * Turning a list of moves into spans of time.
 *
 * Every flow metric is a question about *how long* something stayed somewhere,
 * so this is the primitive the rest of the module is built on. Getting it wrong
 * once would make every metric wrong in the same invisible way.
 *
 * The reference instant arrives as a parameter and is never read from the
 * clock: the metrics instructions require it, because a function that consults
 * `Date.now()` produces a different answer every time it runs and cannot be
 * tested.
 */

export type StateInterval = {
  readonly state: WorkItemState;
  readonly from: Date;
  /** `null` while the item is still in this state at the reference instant. */
  readonly to: Date | null;
  readonly duration: Milliseconds;
};

/**
 * Removes repeats and orders the history.
 *
 * Two defences in one pass:
 *
 * - **duplicates by identifier**, which a connector re-ingesting a window can
 *   easily produce, and which would otherwise double-count time in a state;
 * - **identical timestamps**, resolved by `compareTransitions` on the
 *   identifier, so the order is the same on every run rather than depending on
 *   how the database happened to return the rows.
 */
export function normaliseHistory(
  transitions: readonly StateTransition[],
): readonly StateTransition[] {
  const unique = new Map<string, StateTransition>();
  for (const transition of transitions) unique.set(transition.id, transition);

  return [...unique.values()].sort(compareTransitions);
}

/**
 * The spans an item spent in each state, in order.
 *
 * The last span is open: it runs from the final transition to `asOf`, which is
 * what makes "how long has this been stuck" answerable at all.
 */
export function stateIntervals(
  transitions: readonly StateTransition[],
  asOf: Date,
): readonly StateInterval[] {
  const history = normaliseHistory(transitions);
  if (history.length === 0) return [];

  const intervals: StateInterval[] = [];

  for (const [index, transition] of history.entries()) {
    const next = history[index + 1];
    const from = transition.occurredAt;
    const to = next ? next.occurredAt : null;

    const end = to ?? asOf;
    // Clamped at zero: a reference instant before the last transition would
    // otherwise produce a negative duration that quietly subtracts from totals.
    const duration = Math.max(0, end.getTime() - from.getTime());

    intervals.push({ state: transition.toState, from, to, duration });
  }

  return intervals;
}

/** Total time spent in one state across the whole history, reopenings included. */
export function timeInState(
  transitions: readonly StateTransition[],
  state: WorkItemState,
  asOf: Date,
): Milliseconds {
  return stateIntervals(transitions, asOf)
    .filter((interval) => interval.state === state)
    .reduce((total, interval) => total + interval.duration, 0);
}

/** Total time in states that count as work in progress (`in_progress`, `in_review`). */
export function activeTime(
  transitions: readonly StateTransition[],
  asOf: Date,
): Milliseconds {
  return stateIntervals(transitions, asOf)
    .filter((interval) => isActiveState(interval.state))
    .reduce((total, interval) => total + interval.duration, 0);
}

/**
 * When the item first reached a state, or `null` if it never did.
 *
 * *First* and not *last* on purpose. Cycle time is measured to the first
 * completion: an item finished, reopened and finished again took as long as it
 * took the first time, and measuring to the second arrival would silently
 * reward reopening with a longer, more forgiving number.
 */
export function firstEntryInto(
  transitions: readonly StateTransition[],
  state: WorkItemState,
): Date | null {
  const found = normaliseHistory(transitions).find(
    (transition) => transition.toState === state,
  );
  return found ? found.occurredAt : null;
}

/** When the item last reached a state, or `null`. */
export function lastEntryInto(
  transitions: readonly StateTransition[],
  state: WorkItemState,
): Date | null {
  const history = normaliseHistory(transitions);

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const transition = history[index];
    if (transition?.toState === state) return transition.occurredAt;
  }

  return null;
}

/** The state at `instant`, or `null` if the item did not exist yet. */
export function stateAt(
  transitions: readonly StateTransition[],
  instant: Date,
): WorkItemState | null {
  const history = normaliseHistory(transitions);
  let current: WorkItemState | null = null;

  for (const transition of history) {
    if (transition.occurredAt.getTime() > instant.getTime()) break;
    current = transition.toState;
  }

  return current;
}

/**
 * How many times the item left `done` after having reached it.
 *
 * The raw material of the reopen rate. Counts every return, because an item
 * reopened three times is a different signal from one reopened once.
 */
export function reopenCount(transitions: readonly StateTransition[]): number {
  return normaliseHistory(transitions).filter(
    (transition) => transition.fromState === "done",
  ).length;
}

/** Groups transitions by the item they belong to. */
export function groupByWorkItem(
  transitions: readonly StateTransition[],
): ReadonlyMap<WorkItemId, readonly StateTransition[]> {
  const grouped = new Map<WorkItemId, StateTransition[]>();

  for (const transition of transitions) {
    const existing = grouped.get(transition.workItemId);
    if (existing) existing.push(transition);
    else grouped.set(transition.workItemId, [transition]);
  }

  return grouped;
}
