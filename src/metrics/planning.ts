import {
  countWorkingDays,
  DEFAULT_WORKING_CALENDAR,
  type EstimateChange,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type TeamMemberAvailability,
  type WorkingCalendar,
  type WorkItem,
} from "@/domain";

import { estimateAsOf, hasNoEstimates, totalEstimates, type EstimateTotals } from "./estimates";
import { available, mean, unavailable, type MetricResult } from "./result";
import { membershipEntriesAt, velocity } from "./sprint";

/**
 * Planning: what the team can take on, and what it expects to finish.
 *
 * **Everything before this module answered about the past.** Velocity says what
 * was delivered, burndown says how it went. None of them says what was
 * *expected* — and without an expectation there is no variance, and without
 * variance there is no planning, only reporting.
 *
 * The formulas are the book's, and each is verified against the numeric example
 * printed beside it (ADR-0008). If the code does not reproduce the figure on
 * the page, the code is wrong.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock.
 */

/**
 * Available man-days: the team's capacity for one sprint.
 *
 * > «Let's say we are planning a three-week sprint (15 work days) with a
 * > four-person team. Lisa will be on vacation for two days. Dave is only 50%
 * > available and will be on vacation for one day. Putting all this together …
 * > gives us **50 available man-days** for this sprint.» (pag. 30)
 *
 * Per person: `giorni lavorativi × quota di allocazione − assenze`. The book's
 * own arithmetic on its own example: 15 + 13 + 15 + (7,5 − 1) = 50.
 *
 * **Absences are subtracted after allocation, not before, and the example is
 * what settles it.** Dave is half-time and away one day; the book lands on 6,5,
 * which is 7,5 − 1. Subtracting first would give (15 − 1) × 0,5 = 7 and a total
 * of 50,5. A day off is a whole day gone from the plan, whatever share of it
 * the person would have given.
 *
 * **Always a team total.** There is no per-person variant and there will not be
 * one: §8.2 forbids individual performance figures, and the shortest route to
 * producing one is a function that takes a person and returns days.
 *
 * A person contributing nothing — zero allocation, or away for the whole
 * sprint — is clamped at zero rather than allowed to go negative. Negative
 * capacity would silently cancel out a colleague's real days.
 */
export function availableManDays(
  sprint: Sprint,
  availabilities: readonly TeamMemberAvailability[],
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): MetricResult<number> {
  const forSprint = availabilities.filter(
    (entry) => entry.sprintId === sprint.id,
  );

  if (forSprint.length === 0) return unavailable("no-data", 0);

  const workingDays = countWorkingDays(calendar, sprint.startsAt, sprint.endsAt);
  if (workingDays === 0) return unavailable("empty-denominator", forSprint.length);

  const total = forSprint.reduce((sum, entry) => {
    const days = workingDays * entry.allocationShare - entry.absentWorkingDays;
    return sum + Math.max(0, days);
  }, 0);

  return available(total, forSprint.length);
}

/**
 * Focus factor: how much of the team's time went into committed work.
 *
 * > «Let's say last sprint completed **18 story points** using a three-person
 * > team … working three weeks for a total of **45 man-days**.» (pag. 31)
 *
 * `velocity ÷ man-days` — 18 / 45 = 0,4.
 *
 * **The author retracts this, and the portal says so rather than hiding it**
 * (ADR-0008): «I never use focus factor any more because it takes time, gives a
 * false sense of accuracy, and forces you to estimate stories in ideal
 * man-days.» It stays computable because the book's planning chapter is built
 * on it and a reader deserves to see what is being argued about.
 *
 * **Only in points, and only when the sprint used one unit.** The ratio is
 * meaningful because the book treats a story point as an ideal man-day, so
 * dividing points by days yields a share. Hours divided by days does not, and
 * mixed units divided by anything is arithmetic on two incompatible scales.
 * Rather than produce a plausible number, the result says it cannot.
 *
 * Deliberately **not** capped at 1. A team that beats its own capacity produces
 * a factor above one, and clamping it would erase the very signal that says the
 * estimates, not the team, need looking at.
 */
export function focusFactor(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  availabilities: readonly TeamMemberAvailability[],
  estimateChanges: readonly EstimateChange[] = [],
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): MetricResult<number> {
  const capacity = availableManDays(sprint, availabilities, calendar);
  if (!capacity.available) return unavailable(capacity.reason, capacity.sampleSize);
  if (capacity.value === 0) return unavailable("empty-denominator", capacity.sampleSize);

  const delivered = velocity(sprint, items, transitions, scopeEvents, estimateChanges);
  if (!delivered.available) return unavailable(delivered.reason, delivered.sampleSize);

  const totals = delivered.value;
  if (totals.mixed) return unavailable("mixed-estimate-units", delivered.sampleSize);
  if (totals.points === null) {
    // Hours are a real unit and a real answer to "how much got done"; they are
    // simply not the unit this ratio is defined over.
    return unavailable("no-qualifying-data", delivered.sampleSize);
  }

  return available(totals.points / capacity.value, delivered.sampleSize);
}

/** How the estimated velocity was arrived at. Shown, never inferred. */
export type ForecastMethod =
  /** The average of recent sprints' actual velocity. The author's recommendation. */
  | "yesterdays-weather"
  /** `capacity × focus factor`. The 2007 method, retracted by the author. */
  | "focus-factor"
  /** No history and no capacity: the book's 70% for a brand-new team. */
  | "default-focus-factor";

/**
 * How many past sprints «yesterday's weather» averages.
 *
 * > «pull in only as many story points as you got done last sprint (or the
 * > average of **the last three sprints** if you want to be fancy)» (pag. 89)
 */
export const YESTERDAYS_WEATHER_SPRINTS = 3;

/**
 * The focus factor to assume for a team with no history at all.
 *
 * > «The default focus factor I use for new teams is usually **70%**, since
 * > that is where most of our other teams have ended up over time.» (pag. 32)
 */
export const DEFAULT_FOCUS_FACTOR = 0.7;

/**
 * Yesterday's weather: expect roughly what the team did last time.
 *
 * > «One very simple way to estimate velocity is to look at the team's history.
 * > What was their velocity during the past few sprints? Then assume that the
 * > velocity will be roughly the same next sprint.» (pag. 30)
 *
 * Averages the most recent closed sprints, up to `count`. Only closed ones: a
 * sprint still running has not finished delivering, and folding its
 * part-completed total into the average would drag every forecast down for a
 * reason that is purely an artefact of when the question was asked.
 *
 * In points only, for the same reason as `focusFactor`: an average that mixes
 * units is a number with no meaning.
 */
export function yesterdaysWeather(
  sprints: readonly Sprint[],
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  before: Date,
  estimateChanges: readonly EstimateChange[] = [],
  count: number = YESTERDAYS_WEATHER_SPRINTS,
): MetricResult<number> {
  const closed = sprints
    .filter((sprint) => sprint.completedAt !== null)
    .filter((sprint) => (sprint.completedAt as Date).getTime() < before.getTime())
    .sort(
      (a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime(),
    )
    .slice(0, Math.max(1, count));

  if (closed.length === 0) return unavailable("no-qualifying-data", 0);

  const points: number[] = [];
  for (const sprint of closed) {
    const result = velocity(sprint, items, transitions, scopeEvents, estimateChanges);
    if (!result.available) continue;
    if (result.value.mixed) return unavailable("mixed-estimate-units", closed.length);
    if (result.value.points === null) continue;

    points.push(result.value.points);
  }

  if (points.length === 0) return unavailable("no-qualifying-data", closed.length);

  return mean(points);
}

export type Forecast = {
  /** Expected points for the sprint. */
  readonly points: number;
  readonly method: ForecastMethod;
  /**
   * The focus factor behind the figure, when one was used.
   *
   * `null` for yesterday's weather, which never computes one — and reporting a
   * derived factor there would invent a precision the method does not claim.
   */
  readonly focusFactor: number | null;
};

export type ForecastInput = {
  readonly sprint: Sprint;
  /** Every sprint of the project, so the recent closed ones can be found. */
  readonly sprints: readonly Sprint[];
  readonly items: readonly WorkItem[];
  readonly transitions: readonly StateTransition[];
  readonly scopeEvents: readonly SprintScopeEvent[];
  readonly estimateChanges?: readonly EstimateChange[];
  readonly availabilities?: readonly TeamMemberAvailability[];
  readonly calendar?: WorkingCalendar;
  /**
   * Which method to use. Defaults to the one the author recommends today.
   *
   * Explicit rather than "whichever has data", because a forecast that
   * silently changes method between two sprints changes meaning without
   * saying so.
   */
  readonly method?: ForecastMethod;
};

/**
 * Estimated velocity: how much the team expects to finish.
 *
 * Three routes, and the caller says which (ADR-0008):
 *
 * - **`yesterdays-weather`** — the default, and what the author recommends now.
 * - **`focus-factor`** — `capacity × focus factor of the last closed sprint`.
 *   The 2007 method: «our estimated velocity for the upcoming sprint is 20
 *   story points» from 50 man-days at 40% (pag. 31).
 * - **`default-focus-factor`** — `capacity × 70%`, for a team with no history.
 *
 * A method that has no data returns unavailable **with its reason** rather than
 * quietly falling back to another. A forecast whose method is unclear is worse
 * than none: nobody can argue with it, because nobody knows what it claims.
 */
export function estimatedVelocity(input: ForecastInput): MetricResult<Forecast> {
  const method = input.method ?? "yesterdays-weather";
  const estimateChanges = input.estimateChanges ?? [];
  const availabilities = input.availabilities ?? [];
  const calendar = input.calendar ?? DEFAULT_WORKING_CALENDAR;

  if (method === "yesterdays-weather") {
    const weather = yesterdaysWeather(
      input.sprints,
      input.items,
      input.transitions,
      input.scopeEvents,
      input.sprint.startsAt,
      estimateChanges,
    );

    if (!weather.available) return unavailable(weather.reason, weather.sampleSize);

    return available(
      { points: weather.value, method, focusFactor: null },
      weather.sampleSize,
    );
  }

  const capacity = availableManDays(input.sprint, availabilities, calendar);
  if (!capacity.available) return unavailable(capacity.reason, capacity.sampleSize);

  if (method === "default-focus-factor") {
    return available(
      {
        points: capacity.value * DEFAULT_FOCUS_FACTOR,
        method,
        focusFactor: DEFAULT_FOCUS_FACTOR,
      },
      capacity.sampleSize,
    );
  }

  const previous = mostRecentClosedBefore(input.sprints, input.sprint.startsAt);
  if (!previous) return unavailable("no-qualifying-data", capacity.sampleSize);

  const factor = focusFactor(
    previous,
    input.items,
    input.transitions,
    input.scopeEvents,
    availabilities,
    estimateChanges,
    calendar,
  );

  if (!factor.available) return unavailable(factor.reason, factor.sampleSize);

  return available(
    {
      points: capacity.value * factor.value,
      method,
      focusFactor: factor.value,
    },
    factor.sampleSize,
  );
}

function mostRecentClosedBefore(
  sprints: readonly Sprint[],
  instant: Date,
): Sprint | undefined {
  return sprints
    .filter((sprint) => sprint.completedAt !== null)
    .filter((sprint) => (sprint.completedAt as Date).getTime() < instant.getTime())
    .sort(
      (a, b) => (b.completedAt as Date).getTime() - (a.completedAt as Date).getTime(),
    )[0];
}

/**
 * Committed velocity: the estimates of the work actually pulled into the sprint.
 *
 * > «Since these four stories add up to 19 story points, their **final
 * > estimated velocity** for this sprint is 19.» (pag. 32)
 *
 * The book is careful to separate this from the target. The team aimed at 20,
 * chose four stories totalling 19, and 19 is the plan. Reporting the target
 * instead would measure the sprint against a number nobody committed to.
 *
 * Measured at the **start**, over what the sprint held then: work pulled in
 * later is a scope change, and `scopeChange` is the metric that says so.
 */
export function committedVelocity(
  sprint: Sprint,
  items: readonly WorkItem[],
  scopeEvents: readonly SprintScopeEvent[],
  estimateChanges: readonly EstimateChange[] = [],
): MetricResult<EstimateTotals> {
  const entries = membershipEntriesAt(scopeEvents, sprint, sprint.startsAt);
  if (entries.size === 0) return unavailable("no-data", 0);

  const committed = items.filter((item) => entries.has(item.id));

  const atEntry = estimateAsOf(
    estimateChanges,
    (item) => entries.get(item.id) ?? sprint.startsAt,
  );

  const totals = totalEstimates(committed, atEntry);
  if (hasNoEstimates(totals)) return unavailable("no-qualifying-data", committed.length);

  return available(totals, committed.length);
}

/**
 * How far the sprint landed from what was forecast.
 *
 * > «After each sprint, we look at the actual velocity for that sprint. If the
 * > actual velocity was very different from the estimated velocity, we revise
 * > the estimated velocity for future sprints.» (pag. 101)
 *
 * Positive means more was delivered than expected. Returned as a **signed
 * difference in points, not a ratio**: a ratio hides the size of the sprint it
 * describes, and being three points out on a sprint of five is a different
 * situation from being three out on fifty.
 *
 * **It recomputes the actual velocity rather than accepting one.** An earlier
 * version took the figure as a parameter, which read as an economy and was a
 * trap: nothing stopped a caller passing a velocity computed without the
 * estimate history, and the variance would then have been the difference
 * between a forecast and a number nobody else on the screen agreed with.
 */
export function forecastVariance(
  sprint: Sprint,
  items: readonly WorkItem[],
  transitions: readonly StateTransition[],
  scopeEvents: readonly SprintScopeEvent[],
  forecastPoints: number,
  estimateChanges: readonly EstimateChange[] = [],
): MetricResult<number> {
  const actual = velocity(sprint, items, transitions, scopeEvents, estimateChanges);

  if (!actual.available) return unavailable(actual.reason, actual.sampleSize);
  if (actual.value.mixed) return unavailable("mixed-estimate-units", actual.sampleSize);
  if (actual.value.points === null) {
    return unavailable("no-qualifying-data", actual.sampleSize);
  }

  return available(actual.value.points - forecastPoints, actual.sampleSize);
}
