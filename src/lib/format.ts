/**
 * Turning numbers into text a person reads.
 *
 * The only place rounding is allowed. `src/metrics` keeps full precision on
 * purpose — rounding there would compound through every subsequent
 * calculation — so it happens once, here, at the last possible moment.
 */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * A duration in the largest unit that still reads naturally.
 *
 * "3 giorni" rather than "72 ore", "4 ore" rather than "0,17 giorni". The unit
 * changes with the magnitude because a single fixed unit is always wrong at one
 * end of the range.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";

  if (milliseconds < MS_PER_HOUR) {
    const minutes = Math.round(milliseconds / MS_PER_MINUTE);
    return `${minutes} min`;
  }

  if (milliseconds < MS_PER_DAY) {
    const hours = milliseconds / MS_PER_HOUR;
    return `${formatNumber(hours, 1)} ${hours === 1 ? "ora" : "ore"}`;
  }

  const days = milliseconds / MS_PER_DAY;
  return `${formatNumber(days, 1)} ${days === 1 ? "giorno" : "giorni"}`;
}

/** A number with Italian conventions: comma for decimals, no trailing zeros. */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";

  return value.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

/** A ratio as a percentage. */
export function formatPercent(ratio: number, decimals = 0): string {
  if (!Number.isFinite(ratio)) return "—";

  return `${formatNumber(ratio * 100, decimals)}%`;
}

/** A date as day and month, for an axis label. */
export function formatShortDate(instant: Date): string {
  return instant.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function formatDate(instant: Date): string {
  return instant.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * What to show where a metric has no value.
 *
 * An em dash, never "0" and never an empty cell. A zero would be read as a
 * measurement; a blank invites the reader to assume the page is broken.
 */
export const NO_VALUE = "—";
