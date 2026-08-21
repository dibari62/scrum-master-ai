/**
 * The shape every metric returns.
 *
 * A metric is often uncomputable: a sprint with no finished work has no cycle
 * time, a team with no estimates has no velocity. Those cases must be *said*,
 * not encoded as a number.
 *
 * Returning `0` would be a lie a chart cannot detect — an empty sprint and a
 * catastrophic one would draw the same bar. Returning `NaN` is worse: it
 * propagates silently through arithmetic and surfaces as "NaN" in the
 * interface, or as `null` after a JSON round trip. Both are forbidden by the
 * metrics instructions, and this type is how the ban is enforced rather than
 * remembered.
 */

/** Why a metric could not be produced. Meant to be shown, not swallowed. */
export type UnavailableReason =
  /** Nothing matched the filter: no items, no transitions, no sprint. */
  | "no-data"
  /** Data exists but none of it qualifies — e.g. nothing reached `done`. */
  | "no-qualifying-data"
  /** The denominator would be zero: an average over nothing. */
  | "empty-denominator"
  /** Estimates in more than one unit, which must never be summed. */
  | "mixed-estimate-units";

export type MetricResult<Value> =
  | {
      readonly available: true;
      readonly value: Value;
      /**
       * How many observations the value rests on.
       *
       * Always present, because a cycle time over two items and one over two
       * hundred deserve very different confidence, and a number shown without
       * it invites the reader to trust both equally.
       */
      readonly sampleSize: number;
    }
  | {
      readonly available: false;
      readonly reason: UnavailableReason;
      readonly sampleSize: number;
    };

export function available<Value>(value: Value, sampleSize: number): MetricResult<Value> {
  return { available: true, value, sampleSize };
}

export function unavailable<Value>(
  reason: UnavailableReason,
  sampleSize = 0,
): MetricResult<Value> {
  return { available: false, reason, sampleSize };
}

/**
 * A duration in milliseconds.
 *
 * Milliseconds and not hours or days: the metrics instructions forbid rounding
 * here, and converting to a coarser unit *is* rounding. Presentation decides
 * whether "1.7 giorni" or "41 ore" reads better; this layer keeps everything
 * the source gave it.
 */
export type Milliseconds = number;

export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Mean of a sample, or a stated absence.
 *
 * The one place division by zero would otherwise happen, so it happens here
 * once and correctly instead of at every call site.
 */
export function mean(values: readonly number[]): MetricResult<number> {
  if (values.length === 0) return unavailable("empty-denominator", 0);

  const total = values.reduce((sum, value) => sum + value, 0);
  return available(total / values.length, values.length);
}

/**
 * Median of a sample.
 *
 * Offered alongside the mean because flow data is skewed: one item stuck for
 * three weeks drags an average far from anything the team recognises, while the
 * median keeps describing the typical case.
 */
export function median(values: readonly number[]): MetricResult<number> {
  if (values.length === 0) return unavailable("empty-denominator", 0);

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] as number)
      : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;

  return available(value, sorted.length);
}

/**
 * The `p`-th percentile, interpolating between neighbours.
 *
 * The 85th is the one teams actually use for a commitment: "most items finish
 * within X" is a promise that can be kept, where an average cannot.
 */
export function percentile(values: readonly number[], p: number): MetricResult<number> {
  if (values.length === 0) return unavailable("empty-denominator", 0);
  if (p < 0 || p > 100) throw new Error(`percentile fuori intervallo: ${p}`);

  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return available(sorted[0] as number, 1);

  const position = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;

  const value =
    (sorted[lower] as number) * (1 - weight) + (sorted[upper] as number) * weight;

  return available(value, sorted.length);
}
