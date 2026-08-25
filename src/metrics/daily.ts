import { isTerminalState, type StateTransition, type WorkItemId } from "@/domain";

import { groupByWorkItem, normaliseHistory, stateAt } from "./history";
import { available, unavailable, type MetricResult, type Milliseconds } from "./result";

/**
 * What moved in a window of time, and what did not.
 *
 * **Why this is a metric and not a query.** «Cosa è cambiato ieri» sounds like
 * something a page could look up, and the parts that moved almost are. The part
 * that matters is the other one: what *failed* to move. Standing still is not
 * recorded anywhere — there is no row saying an item spent the day untouched —
 * so it has to be derived, and deriving it is exactly the kind of arithmetic
 * that must not be left to a model (R1).
 *
 * **The window is a parameter, never «yesterday».** The engine does not read the
 * clock (ADR-0002), and it must not decide where a day begins either: that
 * depends on the reader's timezone, and a metric that guessed it would report
 * different facts to two people looking at the same project.
 *
 * Pure and I/O-free.
 */

/** An item that has not moved for a long time, with how long. */
export type StalledItem = {
  readonly workItemId: WorkItemId;
  /** Since the last transition, measured to the end of the window. */
  readonly stillMs: Milliseconds;
};

export type DailyActivity = {
  /** Items that reached `done` inside the window. */
  readonly finished: readonly WorkItemId[];
  /** Items that entered `in_progress` for the first time inside the window. */
  readonly started: readonly WorkItemId[];
  /**
   * Items that left `done` inside the window.
   *
   * Kept apart from the rest because a reopening is the one movement that
   * undoes an earlier one: counting it among «cose che si sono mosse» would let
   * a day of rework read as a day of progress.
   */
  readonly reopened: readonly WorkItemId[];
  /** Items in `blocked` at the end of the window. */
  readonly blocked: readonly WorkItemId[];
  /** Every transition recorded inside the window. */
  readonly movements: number;
  /** How many distinct items moved at all. */
  readonly itemsThatMoved: number;
  /**
   * Open items that have stood still longer than the threshold.
   *
   * Empty when no threshold was given: «fermo da troppo» needs a definition of
   * «troppo», and inventing one here would hide a judgement inside a
   * measurement.
   */
  readonly stalled: readonly StalledItem[];
};

export type DailyActivityInput = {
  readonly transitions: readonly StateTransition[];
  /** Start of the window, included. */
  readonly from: Date;
  /** End of the window, included. */
  readonly to: Date;
  /**
   * How long an open item may stand still before it is worth naming.
   *
   * `null` leaves `stalled` empty rather than picking a default. The caller
   * normally passes the project's own 85th percentile, so what counts as long
   * comes from the project's habits and not from a constant.
   */
  readonly stalledAfterMs: Milliseconds | null;
};

function inWindow(instant: Date, from: Date, to: Date): boolean {
  const time = instant.getTime();
  return time >= from.getTime() && time <= to.getTime();
}

/**
 * Summarises a window of the project's history.
 *
 * Unavailable — rather than a day of empty lists — when there is no history at
 * all: «nothing happened yesterday» and «this project has never recorded
 * anything» are different statements, and a digest that merged them would
 * reassure where it should worry.
 */
export function dailyActivity(input: DailyActivityInput): MetricResult<DailyActivity> {
  if (input.transitions.length === 0) {
    return unavailable("no-data", 0);
  }

  if (input.to.getTime() < input.from.getTime()) {
    return unavailable("no-qualifying-data", 0);
  }

  const byItem = groupByWorkItem(input.transitions);

  const finished: WorkItemId[] = [];
  const started: WorkItemId[] = [];
  const reopened: WorkItemId[] = [];
  const blocked: WorkItemId[] = [];
  const stalled: StalledItem[] = [];

  let movements = 0;
  const moved = new Set<WorkItemId>();

  for (const [workItemId, history] of byItem) {
    const ordered = normaliseHistory(history);

    let enteredProgressBefore = false;

    for (const transition of ordered) {
      const inside = inWindow(transition.occurredAt, input.from, input.to);

      if (!inside) {
        if (
          transition.toState === "in_progress" &&
          transition.occurredAt.getTime() < input.from.getTime()
        ) {
          enteredProgressBefore = true;
        }
        continue;
      }

      movements += 1;
      moved.add(workItemId);

      if (transition.toState === "done") finished.push(workItemId);

      /*
       * «Iniziato» significa iniziato per la prima volta.
       *
       * Un elemento che torna in lavorazione dopo una revisione si sta
       * muovendo, ma non sta cominciando: contarlo fra i lavori iniziati
       * gonfierebbe il digest proprio nei giorni di rilavorazione, cioè quando
       * un resoconto ottimista è più fuorviante.
       */
      if (transition.toState === "in_progress" && !enteredProgressBefore) {
        started.push(workItemId);
        enteredProgressBefore = true;
      }

      if (transition.fromState === "done") reopened.push(workItemId);
    }

    const stateAtEnd = stateAt(ordered, input.to);
    if (stateAtEnd === null) continue;

    if (stateAtEnd === "blocked") blocked.push(workItemId);

    if (input.stalledAfterMs !== null && !isTerminalState(stateAtEnd)) {
      const last = ordered
        .filter((transition) => transition.occurredAt.getTime() <= input.to.getTime())
        .at(-1);

      if (last) {
        const stillMs = input.to.getTime() - last.occurredAt.getTime();
        if (stillMs >= input.stalledAfterMs) {
          stalled.push({ workItemId, stillMs: stillMs as Milliseconds });
        }
      }
    }
  }

  // Il più fermo per primo: è quello di cui vale la pena parlare.
  stalled.sort((left, right) => right.stillMs - left.stillMs);

  return available(
    {
      finished,
      started,
      reopened,
      blocked,
      movements,
      itemsThatMoved: moved.size,
      stalled,
    },
    byItem.size,
  );
}
