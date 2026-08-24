import {
  isMidSprintAddition,
  workItemStateSchema,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type WorkItem,
  type WorkItemId,
  type WorkItemState,
} from "@/domain";

import { EMPTY_TOTALS, totalEstimates, type EstimateTotals } from "./estimates";
import { groupByWorkItem, stateAt } from "./history";
import { available, median, unavailable, type MetricResult } from "./result";

/**
 * Sprint metrics: what the team committed to, what it finished, and what moved
 * under its feet.
 *
 * All of them read `StateTransition` and `SprintScopeEvent` rather than the
 * current state of a work item. `WorkItem.sprintId` says where an item is
 * *now*; a sprint that closed three weeks ago needs to know where it was
 * *then*, and only the history can answer that (ADR-0002).
 */

/**
 * Which items belonged to a sprint at a given instant.
 *
 * Built by replaying additions and removals in order. Replaying rather than
 * reading the current membership is the whole reason `SprintScopeEvent` exists:
 * without it, closing a sprint and moving its leftovers would rewrite history
 * and make every past velocity change.
 */
export function membershipAt(
  scopeEvents: readonly SprintScopeEvent[],
  sprint: Sprint,
  instant: Date,
): ReadonlySet<WorkItemId> {
  const members = new Set<WorkItemId>();

  const relevant = [...scopeEvents]
    .filter((event) => event.sprintId === sprint.id)
    .filter((event) => event.occurredAt.getTime() <= instant.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of relevant) {
    if (event.kind === "added") members.add(event.workItemId);
    else members.delete(event.workItemId);
  }

  return members;
}

/**
 * Velocity: estimates of the work that was done when the sprint closed.
 *
 * The glossary says «arrivati a `done` entro la fine dello sprint, esclusi
 * quelli riaperti dopo». Both halves are satisfied by one question: was the
 * item in `done` at the closing instant? An item finished and then reopened
 * before the end was not done when the sprint closed, and counting it would
 * credit the team with work it still had to do.
 *
 * Returned split by estimate unit, never as one number (see `EstimateTotals`).
 */
export function velocity(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
): MetricResult<EstimateTotals> {
  const closingInstant = sprint.completedAt ?? sprint.endsAt;
  const members = membershipAt(scopeEvents, sprint, closingInstant);
  const byItem = groupByWorkItem(transitions);

  const completed = items.filter((item) => {
    if (!members.has(item.id)) return false;
    return stateAt(byItem.get(item.id) ?? [], closingInstant) === "done";
  });

  if (members.size === 0) return unavailable("no-data", 0);

  return available(totalEstimates(completed), completed.length);
}

export type ScopeChange = {
  /** Estimates of work added after the sprint started. */
  readonly added: EstimateTotals;
  /** Estimates of work taken out after it started. */
  readonly removed: EstimateTotals;
  readonly addedCount: number;
  readonly removedCount: number;
  /** Items present at the start: the commitment the change is measured against. */
  readonly committedCount: number;
};

/**
 * Scope change: work added or removed **after** the sprint began.
 *
 * The comparison against the start instant is strict. Items present exactly at
 * the start are the commitment, not a change to it — treating them as additions
 * would report every sprint as one hundred per cent churn.
 */
export function scopeChange(
  sprint: Sprint,
  items: readonly WorkItem[],
  scopeEvents: readonly SprintScopeEvent[],
): MetricResult<ScopeChange> {
  const forSprint = scopeEvents.filter((event) => event.sprintId === sprint.id);
  if (forSprint.length === 0) return unavailable("no-data", 0);

  const byId = new Map(items.map((item) => [item.id, item]));
  const resolve = (ids: readonly WorkItemId[]): WorkItem[] =>
    ids.map((id) => byId.get(id)).filter((item): item is WorkItem => item !== undefined);

  const addedIds = forSprint
    .filter((event) => isMidSprintAddition(event, sprint))
    .map((event) => event.workItemId);

  const removedIds = forSprint
    .filter(
      (event) =>
        event.kind === "removed" &&
        event.occurredAt.getTime() > sprint.startsAt.getTime(),
    )
    .map((event) => event.workItemId);

  const committed = membershipAt(scopeEvents, sprint, sprint.startsAt);

  return available(
    {
      added: resolve(addedIds).length > 0 ? totalEstimates(resolve(addedIds)) : EMPTY_TOTALS,
      removed:
        resolve(removedIds).length > 0 ? totalEstimates(resolve(removedIds)) : EMPTY_TOTALS,
      addedCount: addedIds.length,
      removedCount: removedIds.length,
      committedCount: committed.size,
    },
    committed.size,
  );
}

export type CarryOver = {
  /** Items that belonged to the sprint at its close and were not done. */
  readonly items: readonly WorkItemId[];
  readonly estimates: EstimateTotals;
  /** Items in the sprint at close, finished or not: the denominator of the share. */
  readonly consideredCount: number;
};

/**
 * Carry-over: work still unfinished when the sprint closed.
 *
 * Deliberately does **not** require the item to appear in the next sprint. The
 * next sprint may not exist yet — the current one is usually the one being
 * asked about — and an unfinished item that nobody pulls forward is a stronger
 * signal than one that gets carried, not a weaker one.
 */
export function carryOver(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
): MetricResult<CarryOver> {
  const closingInstant = sprint.completedAt ?? sprint.endsAt;
  const members = membershipAt(scopeEvents, sprint, closingInstant);
  if (members.size === 0) return unavailable("no-data", 0);

  const byItem = groupByWorkItem(transitions);
  const unfinished = items.filter((item) => {
    if (!members.has(item.id)) return false;

    const state = stateAt(byItem.get(item.id) ?? [], closingInstant);
    // `cancelled` is excluded: abandoned work is not carried forward, and
    // counting it would make cancelling look like failing to finish.
    return state !== "done" && state !== "cancelled";
  });

  return available(
    {
      items: unfinished.map((item) => item.id),
      estimates: unfinished.length > 0 ? totalEstimates(unfinished) : EMPTY_TOTALS,
      consideredCount: members.size,
    },
    members.size,
  );
}

/**
 * How many items the sprint held when it closed.
 *
 * Counted by replaying the composition events, never by reading
 * `WorkItem.sprintId`. That field says where an item is *now*, so every
 * leftover pulled forward into the next sprint would quietly shrink a sprint
 * that closed weeks ago — the exact reason the glossary makes
 * `SprintScopeEvent` a first-class entity.
 *
 * The counting instant is the sprint's closing moment, or `asOf` when the
 * sprint has not reached it yet: counting a running sprint at its planned end
 * would claim to know a composition that has not happened.
 *
 * Unavailable rather than zero when no composition event was recorded: "we
 * never ingested this sprint's contents" and "the sprint was empty" are
 * different statements, and printing `0` for both would merge them.
 */
export function sprintItemCount(
  sprint: Sprint,
  scopeEvents: readonly SprintScopeEvent[],
  asOf: Date,
): MetricResult<number> {
  const forSprint = scopeEvents.filter((event) => event.sprintId === sprint.id);
  if (forSprint.length === 0) return unavailable("no-data", 0);

  const closingInstant = sprint.completedAt ?? sprint.endsAt;
  const instant = asOf.getTime() < closingInstant.getTime() ? asOf : closingInstant;

  const considered = forSprint.filter(
    (event) => event.occurredAt.getTime() <= instant.getTime(),
  );

  // The sample is the number of movements read, not the number of items left:
  // a reader checking the figure needs to know how much history it rests on.
  return available(membershipAt(forSprint, sprint, instant).size, considered.length);
}

export type BurndownPoint = {
  readonly at: Date;
  /** Work still open at this instant, split by estimate unit. */
  readonly remaining: EstimateTotals;
  readonly openCount: number;
};

/**
 * Burndown: how much work was still open on each day of the sprint.
 *
 * Sampled daily at the sprint's start-of-day offset rather than at midnight, so
 * each point answers "where were we at this time yesterday" — the comparison a
 * team actually makes.
 *
 * Membership is recomputed at every point rather than fixed at the start. That
 * is what makes mid-sprint additions visible as a line that goes *up*, which is
 * the entire diagnostic value of the chart.
 *
 * **The line stops at `asOf`, and that is not a detail.** A running sprint has
 * days that have not happened yet, and sampling them produces points identical
 * to the last real one — a flat tail that a reader interprets as a week of work
 * going nowhere. The chart would be asserting something about the future, which
 * is both false and unflattering. Ending the line where the data ends says only
 * what is known.
 */
export function burndown(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  asOf: Date,
): MetricResult<readonly BurndownPoint[]> {
  const byItem = groupByWorkItem(transitions);
  const byId = new Map(items.map((item) => [item.id, item]));

  const points: BurndownPoint[] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  const last = Math.min(sprint.endsAt.getTime(), asOf.getTime());

  for (let at = sprint.startsAt.getTime(); at <= last; at += dayMs) {
    const instant = new Date(at);
    const members = membershipAt(scopeEvents, sprint, instant);

    const open = [...members]
      .map((id) => byId.get(id))
      .filter((item): item is WorkItem => item !== undefined)
      .filter((item) => {
        const state = stateAt(byItem.get(item.id) ?? [], instant);
        return state !== "done" && state !== "cancelled";
      });

    points.push({
      at: instant,
      remaining: open.length > 0 ? totalEstimates(open) : EMPTY_TOTALS,
      openCount: open.length,
    });
  }

  if (points.length === 0) return unavailable("no-data", 0);
  return available(points, points.length);
}

/**
 * Throughput: how many items reached `done` inside a window.
 *
 * A count, never a sum of estimates. Throughput is deliberately unit-free —
 * it answers "how many things finished", which stays comparable across teams
 * that estimate differently or not at all.
 */
export function throughput(
  transitions: readonly StateTransition[],
  from: Date,
  to: Date,
): MetricResult<number> {
  if (to.getTime() <= from.getTime()) return unavailable("empty-denominator", 0);

  const byItem = groupByWorkItem(transitions);
  let completed = 0;

  for (const history of byItem.values()) {
    const reached = history
      .filter((transition) => transition.toState === "done")
      .map((transition) => transition.occurredAt.getTime())
      .sort((a, b) => a - b)[0];

    if (reached === undefined) continue;
    if (reached >= from.getTime() && reached <= to.getTime()) completed += 1;
  }

  return available(completed, byItem.size);
}

/**
 * Work in progress: items in an active state at an instant.
 *
 * `blocked` is excluded, following `isActiveState` in the domain: an item
 * nobody can move is not being worked on, and counting it would let a stuck
 * team look busy while its WIP limit appears respected.
 */
export function workInProgress(
  transitions: readonly StateTransition[],
  instant: Date,
): MetricResult<number> {
  const byItem = groupByWorkItem(transitions);
  if (byItem.size === 0) return unavailable("no-data", 0);

  let count = 0;
  for (const history of byItem.values()) {
    const state = stateAt(history, instant);
    if (state === "in_progress" || state === "in_review") count += 1;
  }

  return available(count, byItem.size);
}

/**
 * How many items sit in each state at an instant.
 *
 * The figure a board needs: a column shows a state, and the question it answers
 * is "how full is this one right now".
 *
 * **Counted per state, not per column, and that is not a shortcut.** A project
 * may map several columns onto the same canonical state — "In review" and
 * "Waiting for QA" are both `in_review` — and nothing in the history records
 * which of the two an item was sitting in. A per-column count would therefore
 * have to invent the split. The caller receives states and is left to say so
 * where the mapping is ambiguous.
 *
 * Every state appears in the result, including the empty ones. A state missing
 * from a map reads as "unknown" at the call site, and here it is known: it is
 * zero. Making the caller distinguish the two is how a board ends up with a
 * blank cell where it should show a nought.
 */
export function workItemsByState(
  transitions: readonly StateTransition[],
  instant: Date,
): MetricResult<ReadonlyMap<WorkItemState, number>> {
  const byItem = groupByWorkItem(transitions);
  if (byItem.size === 0) return unavailable("no-data", 0);

  const counts = new Map<WorkItemState, number>(
    workItemStateSchema.options.map((state) => [state, 0]),
  );

  for (const history of byItem.values()) {
    const state = stateAt(history, instant);
    if (state === null) continue;
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }

  return available(counts, byItem.size);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The typical length of this team's sprints, in whole days.
 *
 * Lives here rather than beside the wizard that shows it because it is a
 * calculation over canonical `Sprint`s, and R1 puts every calculation in code
 * that is pure and tested. The wizard proposes the number; it does not work it
 * out.
 *
 * The median, not the mean: one sprint cut short by a holiday would drag an
 * average away from the length the team actually works to, which is the value
 * being asked for.
 *
 * Sprints whose dates make no sense are excluded rather than clamped — a sprint
 * ending before it starts is a defect in the source, and silently treating it
 * as zero days would let that defect quietly shorten the proposal.
 */
export function typicalSprintLengthDays(
  sprints: readonly Sprint[],
): MetricResult<number> {
  const lengths = sprints
    .map((sprint) => sprint.endsAt.getTime() - sprint.startsAt.getTime())
    .filter((span) => span > 0)
    .map((span) => span / MS_PER_DAY);

  // Fewer than two observations is not a habit, it is an accident. Reporting
  // "unavailable" lets the caller say so, instead of presenting one sprint as
  // if it were a pattern.
  if (lengths.length < 2) return unavailable("no-qualifying-data", lengths.length);

  const middle = median(lengths);
  if (!middle.available) return unavailable("no-qualifying-data", lengths.length);

  return available(Math.max(1, Math.round(middle.value)), lengths.length);
}
