/**
 * Turning numbers into coordinates.
 *
 * Kept apart from the components that draw, because this is arithmetic and
 * arithmetic can be tested. A scale that is subtly wrong produces a chart that
 * looks plausible and lies — the exact failure mode the whole project is built
 * to avoid.
 */

export type Scale = {
  /** Maps a value to a position on the axis. */
  readonly to: (value: number) => number;
  readonly domain: readonly [min: number, max: number];
  readonly range: readonly [start: number, end: number];
};

/**
 * A linear scale from a value range to a pixel range.
 *
 * A zero-width domain — every value identical — would divide by zero, so it
 * collapses to the middle of the range instead. A flat line drawn halfway up is
 * honest; `NaN` coordinates would silently produce an empty chart.
 */
export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const [min, max] = domain;
  const [start, end] = range;
  const span = max - min;

  const to = (value: number): number => {
    if (span === 0) return (start + end) / 2;

    const ratio = (value - min) / span;
    return start + ratio * (end - start);
  };

  return { to, domain, range };
}

/**
 * A domain that always includes zero and leaves headroom above the data.
 *
 * Starting a bar chart above zero exaggerates differences: two bars of 95 and
 * 100 look like a doubling if the axis starts at 90. Cutting the axis is a
 * legitimate technique when labelled, and a lie when it is not — so this never
 * does it.
 */
export function niceDomain(values: readonly number[]): readonly [number, number] {
  if (values.length === 0) return [0, 1];

  const max = Math.max(...values, 0);
  if (max === 0) return [0, 1];

  return [0, max * 1.1];
}

/** Evenly spaced tick values across a domain, endpoints included. */
export function ticks(domain: readonly [number, number], count: number): readonly number[] {
  if (count < 2) return [domain[0]];

  const [min, max] = domain;
  const step = (max - min) / (count - 1);

  return Array.from({ length: count }, (_, index) => min + step * index);
}

/**
 * Builds the `d` attribute of an SVG path through the points.
 *
 * Straight segments, no smoothing: a curved burndown implies measurements
 * between the days that were never taken.
 */
export function polylinePath(points: readonly (readonly [number, number])[]): string {
  if (points.length === 0) return "";

  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
}

/**
 * Roughly how wide a string will be, in SVG units.
 *
 * An estimate, and knowingly so: text cannot be measured on the server, where
 * these charts are drawn. The alternative was a fixed gutter, which clipped
 * "31 punti · 3 senza stima" into "31 punti · 3 senza" — a label that reads as
 * a complete sentence and says something the data does not.
 *
 * `0.58` is an average character width for the sans-serif stack at a given size.
 * It overestimates narrow text and underestimates a string of capitals, which is
 * the right way round: a little unused space costs nothing, a truncated label
 * misinforms.
 */
export function approximateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58;
}

/**
 * Fits label and value gutters around a plot area of usable width.
 *
 * Both are capped, because one very long name must shrink itself rather than
 * squash every bar in the chart into invisibility.
 */
export function barChartGutters(input: {
  readonly totalWidth: number;
  readonly labels: readonly string[];
  readonly values: readonly string[];
  readonly labelFontSize: number;
  readonly valueFontSize: number;
}): { readonly labelWidth: number; readonly valueWidth: number } {
  const MIN_PLOT_WIDTH = 160;
  const PADDING = 12;

  const widest = (texts: readonly string[], fontSize: number): number =>
    texts.reduce((max, text) => Math.max(max, approximateTextWidth(text, fontSize)), 0);

  const wantedLabel = widest(input.labels, input.labelFontSize) + PADDING;
  const wantedValue = widest(input.values, input.valueFontSize) + PADDING;

  const available = input.totalWidth - MIN_PLOT_WIDTH;
  if (wantedLabel + wantedValue <= available) {
    return { labelWidth: wantedLabel, valueWidth: wantedValue };
  }

  // Over budget: both shrink in proportion to what they asked for, so neither
  // is sacrificed entirely to the other. The second is the remainder rather
  // than another product, so the plot keeps its minimum width exactly instead
  // of losing it to rounding.
  const labelWidth = (available * wantedLabel) / (wantedLabel + wantedValue);
  return { labelWidth, valueWidth: available - labelWidth };
}
