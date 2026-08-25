import { z } from "zod";

/**
 * Which days this project actually works on.
 *
 * **Why this exists.** The burndown chart used to sample every calendar day,
 * so a sprint spanning two weekends drew four flat days. Kniberg describes
 * exactly that mistake and why he stopped making it in 2007: «We skip weekends
 * on the X-axis since work is rarely done on weekends. We used to include
 * weekends but this would make the burn down slightly confusing, since it would
 * flatten out over weekends, **which would look like a warning sign**»
 * (*Scrum and XP from the Trenches*, pag. 62). A chart that manufactures alarms
 * teaches people to ignore it.
 *
 * **Why it lives in the domain and not beside the connector that knows about
 * weekends.** `src/connectors/seed/calendar.ts` already skips weekends, but
 * `metrics` may not import `connectors` (AGENTS.md §4) — and the rule is right
 * here rather than incidental: which days a team works is a property of the
 * *project*, not of the tool the data came from. The same team keeps its
 * Friday-off calendar whether its board lives in GitHub or in a spreadsheet.
 *
 * Everything here reads UTC. Dates are stored in UTC (§7), and UTC has no
 * daylight saving, so stepping forward by exactly 24 hours can never land on
 * the same local day twice or skip one.
 */

/** Named rather than numbered: "day 0" means Sunday somewhere and Monday elsewhere. */
export const dayOfWeekSchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;

/**
 * `Date.getUTCDay()` returns 0 for Sunday, so the array starts there.
 *
 * This offset is the entire reason `DayOfWeek` is a name and not a number: the
 * mapping is arbitrary, and every place that rediscovered it got it wrong once.
 */
const DAY_BY_UTC_INDEX: readonly DayOfWeek[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** A single day, `YYYY-MM-DD` in UTC. A holiday is a day, not an instant. */
export const calendarDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La data va indicata come AAAA-MM-GG.");

export type CalendarDate = z.infer<typeof calendarDateSchema>;

export const MAX_HOLIDAYS = 400;

export const workingCalendarSchema = z.object({
  /**
   * Non-empty by construction.
   *
   * A calendar with no working days would make every day-stepping loop either
   * empty or unbounded, depending on how it was written. Rejecting it here means
   * no caller has to defend against it.
   */
  workingDays: z
    .array(dayOfWeekSchema)
    .min(1, "Un progetto deve avere almeno un giorno lavorativo.")
    .refine(
      (days) => new Set(days).size === days.length,
      "Un giorno della settimana non può comparire due volte.",
    ),

  /**
   * Days off that are not weekly: public holidays, company shutdowns.
   *
   * Bounded so a bad import cannot turn a calendar into an unbounded list; the
   * ceiling catches a defect, it is not a preference.
   */
  holidays: z.array(calendarDateSchema).max(MAX_HOLIDAYS),
});

export type WorkingCalendar = z.infer<typeof workingCalendarSchema>;

/**
 * Monday to Friday, no holidays.
 *
 * The value a project has before anyone configures one. It is the assumption
 * the synthetic data already makes, so making it the default keeps the seeded
 * history and the chart telling the same story.
 */
export const DEFAULT_WORKING_CALENDAR: WorkingCalendar = {
  workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  holidays: [],
};

/** The `YYYY-MM-DD` of an instant, in UTC. */
export function toCalendarDate(instant: Date): CalendarDate {
  return instant.toISOString().slice(0, 10);
}

export function dayOfWeekOf(instant: Date): DayOfWeek {
  // Safe: getUTCDay() is always 0-6 and the table has seven entries.
  return DAY_BY_UTC_INDEX[instant.getUTCDay()] as DayOfWeek;
}

export function isWorkingDay(calendar: WorkingCalendar, instant: Date): boolean {
  if (calendar.holidays.includes(toCalendarDate(instant))) return false;
  return calendar.workingDays.includes(dayOfWeekOf(instant));
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Every working instant from `from` to `to` inclusive, one per day.
 *
 * **The time of day is preserved, and that is the point.** Stepping by exactly
 * 24 hours from the sprint's start instant means each sample answers "where
 * were we at this time yesterday" — the comparison a team actually makes —
 * instead of "where were we at midnight UTC", which for a European team is the
 * middle of the previous evening.
 *
 * Returns nothing when `from` is after `to`. That is a legitimate question with
 * an empty answer (a sprint asked about before it started), not an error.
 */
export function workingDayInstants(
  calendar: WorkingCalendar,
  from: Date,
  to: Date,
): readonly Date[] {
  const instants: Date[] = [];

  for (let at = from.getTime(); at <= to.getTime(); at += MS_PER_DAY) {
    const instant = new Date(at);
    if (isWorkingDay(calendar, instant)) instants.push(instant);
  }

  return instants;
}

/**
 * How many working days fall between two instants, inclusive.
 *
 * The unit of capacity: the book's «three-week sprint (15 work days)» is this
 * number, not the twenty-one days the calendar shows.
 */
export function countWorkingDays(
  calendar: WorkingCalendar,
  from: Date,
  to: Date,
): number {
  return workingDayInstants(calendar, from, to).length;
}
