import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import type { MetricResult } from "@/metrics";

/**
 * Turning metric results into the strings a component can display.
 *
 * Lives in `src/app` because it is the translation between two layers that must
 * not know each other: `src/metrics` produces results, `src/components` draws
 * strings, and §4 forbids the second from importing the first. The adapter has
 * to sit somewhere, and the page is the only place allowed to see both.
 *
 * It is also where rounding happens — the metrics engine keeps full precision
 * on purpose, so rounding once at the edge is the whole discipline.
 */

export type PresentedMetric = {
  readonly value: string | null;
  readonly detail: string;
};

const REASONS = {
  "no-data": "nessun dato nel periodo",
  "no-qualifying-data": "nessun elemento soddisfa la definizione",
  "empty-denominator": "campione vuoto",
  "mixed-estimate-units": "unità di stima diverse, non sommabili",
} as const;

function sampleText(size: number): string {
  return `su ${formatNumber(size)} ${size === 1 ? "elemento" : "elementi"}`;
}

/** Formats any numeric metric with the given formatter. */
export function present(
  result: MetricResult<number>,
  format: (value: number) => string,
): PresentedMetric {
  if (!result.available) {
    return { value: null, detail: REASONS[result.reason] };
  }

  return { value: format(result.value), detail: sampleText(result.sampleSize) };
}

export function presentDuration(result: MetricResult<number>): PresentedMetric {
  return present(result, formatDuration);
}

export function presentCount(result: MetricResult<number>): PresentedMetric {
  return present(result, (value) => formatNumber(value));
}

export function presentPercent(
  result: MetricResult<number>,
  decimals = 0,
): PresentedMetric {
  return present(result, (value) => formatPercent(value, decimals));
}

/**
 * Estimate totals as text, never collapsing two units into one number.
 *
 * "13 punti + 4 ore" is longer than "17" and is the only honest rendering: the
 * two figures have no common meaning, and joining them would invent one.
 */
export function presentEstimates(totals: {
  readonly points: number | null;
  readonly hours: number | null;
  readonly unestimatedCount: number;
}): string {
  const parts: string[] = [];
  if (totals.points !== null) parts.push(`${formatNumber(totals.points, 1)} punti`);
  if (totals.hours !== null) parts.push(`${formatNumber(totals.hours, 1)} ore`);

  if (parts.length === 0) return "nessuna stima";

  const base = parts.join(" + ");
  return totals.unestimatedCount > 0
    ? `${base} · ${formatNumber(totals.unestimatedCount)} senza stima`
    : base;
}
