import { formatNumber } from "@/lib/format";

import { barChartGutters, linearScale, niceDomain } from "./scale";

/**
 * A horizontal bar chart, drawn as SVG on the server.
 *
 * Horizontal rather than vertical because the labels are sprint names and
 * metric names — text that reads left to right and would otherwise have to be
 * rotated or truncated.
 *
 * The axis always starts at zero (see `niceDomain`): a bar chart cut above zero
 * turns a five per cent difference into a visual doubling.
 */

export type Bar = {
  readonly label: string;
  /** `null` when the metric was not available: drawn as absent, not as zero. */
  readonly value: number | null;
  /** Shown at the end of the bar; falls back to the formatted value. */
  readonly display?: string;
  /** Marks a bar that deserves attention, such as the sprint being discussed. */
  readonly highlight?: boolean;
};

type BarChartProps = {
  readonly bars: readonly Bar[];
  readonly title: string;
  readonly unitLabel?: string;
};

const WIDTH = 720;
const ROW_HEIGHT = 34;
const LABEL_FONT_SIZE = 12;
const VALUE_FONT_SIZE = 11;

export function BarChart({ bars, title, unitLabel }: BarChartProps) {
  if (bars.length === 0) {
    return <p className="text-muted-foreground text-sm">Nessun dato da mostrare.</p>;
  }

  const height = bars.length * ROW_HEIGHT + 8;

  /**
   * Decided once, from the text actually being drawn.
   *
   * The value column used to be a fixed 90 units, which silently clipped
   * anything longer — a chart that cuts off the second half of its own labels
   * is worse than one that is merely ugly.
   */
  const displays = bars.map(
    (bar) =>
      bar.display ??
      (bar.value === null
        ? "non disponibile"
        : `${formatNumber(bar.value, 1)}${unitLabel ? ` ${unitLabel}` : ""}`),
  );

  const { labelWidth, valueWidth } = barChartGutters({
    totalWidth: WIDTH,
    labels: bars.map((bar) => bar.label),
    values: displays,
    labelFontSize: LABEL_FONT_SIZE,
    valueFontSize: VALUE_FONT_SIZE,
  });

  const plotStart = labelWidth;
  const plotEnd = WIDTH - valueWidth;

  const present = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== null);

  const x = linearScale(niceDomain(present), [plotStart, plotEnd]);

  return (
    <figure className="grid gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={title}
      >
        {bars.map((bar, index) => {
          const y = index * ROW_HEIGHT + 4;
          const barHeight = ROW_HEIGHT - 14;
          const width = bar.value === null ? 0 : x.to(bar.value) - plotStart;

          return (
            <g key={bar.label}>
              <text
                x={0}
                y={y + barHeight / 2}
                dominantBaseline="middle"
                className="fill-foreground text-[12px]"
              >
                {bar.label}
              </text>

              {/* A track behind every bar, so an absent value still shows a row
                  rather than looking like a rendering failure. */}
              <rect
                x={plotStart}
                y={y}
                width={plotEnd - plotStart}
                height={barHeight}
                rx={3}
                className="fill-muted"
              />

              {bar.value !== null ? (
                <rect
                  x={plotStart}
                  y={y}
                  width={Math.max(width, 2)}
                  height={barHeight}
                  rx={3}
                  className={bar.highlight ? "fill-destructive" : "fill-primary"}
                />
              ) : null}

              <text
                x={plotEnd + 8}
                y={y + barHeight / 2}
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {displays[index]}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
