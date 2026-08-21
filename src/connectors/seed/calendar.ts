/**
 * Working-day arithmetic.
 *
 * The synthetic history skips weekends. Not decoration: a burndown chart that
 * descends smoothly through Saturday and Sunday is visibly wrong to anyone who
 * has ever run a sprint, and the whole point of this data set is that it should
 * withstand being looked at.
 *
 * Everything is UTC (AGENTS.md §7). No timezone is applied here — that belongs
 * at the edge of the interface, not to generated data.
 */

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export function isWeekend(instant: Date): boolean {
  const day = instant.getUTCDay();
  return day === 0 || day === 6;
}

export function addHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * MS_PER_HOUR);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * MS_PER_DAY);
}

/** Moves forward to the next working day, leaving a weekday untouched. */
export function nextWorkingDay(instant: Date): Date {
  let moved = instant;
  while (isWeekend(moved)) moved = addDays(moved, 1);
  return moved;
}

/**
 * Adds working hours, stepping over weekends.
 *
 * Approximate on purpose: it does not model an eight-hour day, only the fact
 * that nothing happens on Saturday and Sunday. Modelling office hours would add
 * precision the metrics cannot use.
 */
export function addWorkingHours(instant: Date, hours: number): Date {
  let moved = addHours(instant, hours);
  while (isWeekend(moved)) moved = addDays(moved, 1);
  return moved;
}

/** Sets the time of day, keeping the date. Used to place events in office hours. */
export function atHour(instant: Date, hour: number, minute = 0): Date {
  const moved = new Date(instant.getTime());
  moved.setUTCHours(hour, minute, 0, 0);
  return moved;
}

/** Whole days between two instants, rounded down. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}
