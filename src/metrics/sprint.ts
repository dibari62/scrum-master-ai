import {
  isMidSprintAddition,
  workItemStateSchema,
  workingDayInstants,
  DEFAULT_WORKING_CALENDAR,
  type EstimateChange,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type WorkingCalendar,
  type WorkItem,
  type WorkItemId,
  type WorkItemState,
} from "@/domain";

import {
  EMPTY_TOTALS,
  estimateAsOf,
  estimateAtInstant,
  totalEstimates,
  type EstimateTotals,
} from "./estimates";
import { groupByWorkItem, stateAt } from "./history";
import { available, median, unavailable, type MetricResult } from "./result";

/**
 * Sprint metrics: what the team committed to, what it finished, and what moved
 * under its feet.
 *
 * All of them read `StateTransition` and `SprintScopeEvent` rather than the
 * current state of a work item. `WorkItem.sprintId` says where an item is
 * *now*; a sprint that closed three weeks ago needs to know where it was
 * *then*, and only the history can answer that (ADR-0003).
 *
 * The same rule now applies to estimates. `WorkItem.estimate` says what it is
 * sized at *now*; `EstimateChange` says what it was sized at *then*, and every
 * figure below that describes a closed moment reads the second (ADR-0008).
 */

/**
 * When each item entered the sprint, replaying additions and removals in order.
 *
 * Built by replaying rather than reading the current membership: that is the
 * whole reason `SprintScopeEvent` exists. Closing a sprint and moving its
 * leftovers would otherwise rewrite history and make every past velocity
 * change.
 *
 * An item removed and later added back reports the **later** entry. It is the
 * arrival that put it into the plan the team is being measured against; the
 * earlier one was undone.
 */
export function membershipEntriesAt(
  scopeEvents: readonly SprintScopeEvent[],
  sprint: Sprint,
  instant: Date,
): ReadonlyMap<WorkItemId, Date> {
  const entries = new Map<WorkItemId, Date>();

  const relevant = [...scopeEvents]
    .filter((event) => event.sprintId === sprint.id)
    .filter((event) => event.occurredAt.getTime() <= instant.getTime())
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const event of relevant) {
    if (event.kind === "added") entries.set(event.workItemId, event.occurredAt);
    else entries.delete(event.workItemId);
  }

  return entries;
}

/**
 * Which items belonged to a sprint at a given instant.
 *
 * The membership half of `membershipEntriesAt`, kept as its own name because
 * most callers only need the set.
 */
export function membershipAt(
  scopeEvents: readonly SprintScopeEvent[],
  sprint: Sprint,
  instant: Date,
): ReadonlySet<WorkItemId> {
  return new Set(membershipEntriesAt(scopeEvents, sprint, instant).keys());
}

/**
 * Velocity: the **initial** estimates of the work that was done when the sprint
 * closed.
 *
 * Two rules from the book, and they are separate.
 *
 * **Which items count.** The glossary says «arrivati a `done` entro la fine
 * dello sprint, esclusi quelli riaperti dopo». Both halves are satisfied by one
 * question: was the item in `done` at the closing instant? An item finished and
 * then reopened before the end was not done when the sprint closed, and
 * counting it would credit the team with work it still had to do. There is no
 * partial credit either — «The value of stuff half-done is zero (may in fact be
 * negative)» (pag. 30).
 *
 * **Which estimate counts.** «the actual velocity is based on the *initial*
 * estimates of each story. Any updates to the story time estimates done during
 * the sprint are ignored» (pag. 29). *Initial* means at the moment the item
 * entered **this** sprint, not at the moment it was created: an item pulled in
 * on day six carried its day-six size into the plan, and nothing earlier was
 * ever promised.
 *
 * Without this the number is not merely imprecise, it is unstable: correcting a
 * story's estimate today would move the velocity of a sprint closed weeks ago.
 *
 * Returned split by estimate unit, never as one number (see `EstimateTotals`).
 */
export function velocity(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  estimateChanges: readonly EstimateChange[] = [],
): MetricResult<EstimateTotals> {
  const closingInstant = sprint.completedAt ?? sprint.endsAt;
  const entries = membershipEntriesAt(scopeEvents, sprint, closingInstant);
  const byItem = groupByWorkItem(transitions);

  const completed = items.filter((item) => {
    if (!entries.has(item.id)) return false;
    return stateAt(byItem.get(item.id) ?? [], closingInstant) === "done";
  });

  if (entries.size === 0) return unavailable("no-data", 0);

  const initial = estimateAsOf(
    estimateChanges,
    (item) => entries.get(item.id) ?? sprint.startsAt,
  );

  return available(totalEstimates(completed, initial), completed.length);
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
  estimateChanges: readonly EstimateChange[] = [],
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

  // Sized as they were when the sprint closed, not as they are today. The
  // figure answers "how much did the plan move", and a re-estimate made after
  // the sprint ended is not the plan moving.
  const asAtClose = estimateAtInstant(
    estimateChanges,
    sprint.completedAt ?? sprint.endsAt,
  );

  return available(
    {
      added:
        resolve(addedIds).length > 0
          ? totalEstimates(resolve(addedIds), asAtClose)
          : EMPTY_TOTALS,
      removed:
        resolve(removedIds).length > 0
          ? totalEstimates(resolve(removedIds), asAtClose)
          : EMPTY_TOTALS,
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
  estimateChanges: readonly EstimateChange[] = [],
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

  // Sized as at the close: how much was left *then*, which is what the next
  // sprint had to absorb. A later re-estimate belongs to the next sprint's
  // story, not to this one's.
  const asAtClose = estimateAtInstant(estimateChanges, closingInstant);

  return available(
    {
      items: unfinished.map((item) => item.id),
      estimates:
        unfinished.length > 0 ? totalEstimates(unfinished, asAtClose) : EMPTY_TOTALS,
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

  /**
   * Where a perfectly even burn would have been on this day, in points.
   *
   * `null` when the sprint's work is not measured in points — an ideal line in
   * hours drawn on a chart of points would be a second line meaning something
   * else, which is worse than no line.
   *
   * This is the book's dashed guideline: «The dashed trend line shows that they
   * are approximately on track» (pag. 62). It is arithmetic over the starting
   * total and the number of working days, not a prediction: nothing here knows
   * anything about the future.
   */
  readonly ideal: number | null;
};

export type Burndown = {
  readonly points: readonly BurndownPoint[];

  /**
   * How many working days the sprint holds in total, including those still to
   * come.
   *
   * Needed to draw the ideal line to its end even while the actual line stops
   * at today, which is the comparison the chart is for.
   */
  readonly totalWorkingDays: number;
};

export type BurndownOptions = {
  /**
   * Which days count. Defaults to Monday-Friday with no holidays.
   *
   * An options object rather than two more positional parameters: both of these
   * are things a caller usually wants to leave alone, and a sixth positional
   * argument is where call sites start passing them in the wrong order.
   */
  readonly calendar?: WorkingCalendar;
  readonly estimateChanges?: readonly EstimateChange[];
};

/**
 * Burndown: how much work was still open on each **working day** of the sprint.
 *
 * **Weekends are skipped, and that is the whole point of the calendar.** The
 * chart used to sample every calendar day, so a three-week sprint drew four
 * flat days that nobody worked. Kniberg describes making and undoing exactly
 * that mistake: «We used to include weekends but this would make the burn down
 * slightly confusing, since it would flatten out over weekends, **which would
 * look like a warning sign**» (pag. 62). A chart that invents alarms trains
 * people to ignore real ones.
 *
 * Sampled at the sprint's start-of-day offset rather than at midnight, so each
 * point answers "where were we at this time yesterday" — the comparison a team
 * actually makes.
 *
 * Membership is recomputed at every point rather than fixed at the start. That
 * is what makes mid-sprint additions visible as a line that goes *up*, which is
 * the entire diagnostic value of the chart. Each item is sized as it was **on
 * that day**: the burndown is the team's own running answer to "how much is
 * left", and a re-estimate on day six is part of that answer, not a correction
 * to be hidden.
 *
 * **The line stops at `asOf`, and that is not a detail.** A running sprint has
 * days that have not happened yet, and sampling them produces points identical
 * to the last real one — a flat tail that a reader interprets as a week of work
 * going nowhere. The chart would be asserting something about the future, which
 * is both false and unflattering. Ending the line where the data ends says only
 * what is known; `totalWorkingDays` still lets the ideal line reach the end.
 */
export function burndown(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  asOf: Date,
  options: BurndownOptions = {},
): MetricResult<Burndown> {
  const calendar = options.calendar ?? DEFAULT_WORKING_CALENDAR;
  const estimateChanges = options.estimateChanges ?? [];

  const byItem = groupByWorkItem(transitions);
  const byId = new Map(items.map((item) => [item.id, item]));

  const last = new Date(Math.min(sprint.endsAt.getTime(), asOf.getTime()));
  const sampled = workingDayInstants(calendar, sprint.startsAt, last);

  if (sampled.length === 0) return unavailable("no-data", 0);

  const totalWorkingDays = workingDayInstants(
    calendar,
    sprint.startsAt,
    sprint.endsAt,
  ).length;

  const measured = sampled.map((instant) => {
    const members = membershipAt(scopeEvents, sprint, instant);

    const open = [...members]
      .map((id) => byId.get(id))
      .filter((item): item is WorkItem => item !== undefined)
      .filter((item) => {
        const state = stateAt(byItem.get(item.id) ?? [], instant);
        return state !== "done" && state !== "cancelled";
      });

    return {
      at: instant,
      remaining:
        open.length > 0
          ? totalEstimates(open, estimateAtInstant(estimateChanges, instant))
          : EMPTY_TOTALS,
      openCount: open.length,
    };
  });

  const start = measured[0]?.remaining.points ?? null;

  // A single-day sprint has nothing to slope down: the ideal line would be a
  // division by zero, so it is simply absent rather than nought.
  const slope = start !== null && totalWorkingDays > 1 ? start / (totalWorkingDays - 1) : null;

  const points: BurndownPoint[] = measured.map((point, index) => ({
    ...point,
    ideal: slope === null || start === null ? null : Math.max(0, start - slope * index),
  }));

  return available({ points, totalWorkingDays }, points.length);
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
