import { formatNumber, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import { linearScale, niceDomain, polylinePath, ticks } from "./scale";

/**
 * A burndown chart, drawn as SVG on the server.
 *
 * No charting library and no client-side JavaScript: `AGENTS.md` §3 admits no
 * component library beyond shadcn/ui, and a line with axes is arithmetic plus
 * markup. It also means the chart appears in the first response rather than
 * after a bundle loads, and survives with JavaScript disabled.
 *
 * Presentational only (§4): it receives numbers already computed by
 * `src/metrics` and decides nothing about them.
 */

export type BurndownSeries = {
  readonly at: Date;
  readonly remaining: number;
};

type BurndownChartProps = {
  readonly points: readonly BurndownSeries[];
  /** Work committed at the start, used to draw the ideal line. */
  readonly committed: number;
  readonly unitLabel: string;
  readonly title: string;
};

const WIDTH = 720;
const HEIGHT = 220;
const PADDING = { top: 16, right: 16, bottom: 16, left: 48 };

/**
 * The vertical axis labels: hidden where they could not be read.
 *
 * A `viewBox` 720 units wide is scaled to fit its column, and *within the range
 * we call "phone" that factor nearly doubles* — 0,39 at 375 pixels, 0,75 at
 * 639. No single declared size is right across that, which is the flaw at the
 * heart of putting text inside a scalable drawing.
 *
 * So below the breakpoint the numbers are not shrunk, they are dropped, and the
 * gridlines they annotated stay. The chart keeps showing the shape; the actual
 * figures are stated as real text underneath, where they can be read at any
 * width and selected. Rendering something illegible would be the same mistake
 * as printing `0` where a metric is unavailable: it looks like information and
 * is not.
 *
 * Above the breakpoint the scale settles between 0,75 and 1,11, which two
 * declared sizes can cover honestly.
 */
const AXIS_TEXT = "max-sm:hidden text-[14px] md:text-[11px]";

export function BurndownChart({
  points,
  committed,
  unitLabel,
  title,
}: BurndownChartProps) {
  if (points.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nessun dato per tracciare il burndown.
      </p>
    );
  }

  const first = points[0];
  const last = points[points.length - 1];

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const values = points.map((point) => point.remaining);
  const yDomain = niceDomain([...values, committed]);

  const x = linearScale([0, Math.max(points.length - 1, 1)], [
    PADDING.left,
    PADDING.left + plotWidth,
  ]);
  // Inverted range: SVG grows downwards, charts grow upwards.
  const y = linearScale(yDomain, [PADDING.top + plotHeight, PADDING.top]);

  const actual = polylinePath(
    points.map((point, index) => [x.to(index), y.to(point.remaining)] as const),
  );

  /**
   * The ideal line: from the commitment down to zero, straight.
   *
   * Drawn from the *committed* amount rather than from the first actual point,
   * so mid-sprint additions show up as the actual line rising above the ideal
   * instead of quietly moving the reference.
   */
  const ideal = polylinePath([
    [x.to(0), y.to(committed)],
    [x.to(points.length - 1), y.to(0)],
  ]);

  const yTicks = ticks(yDomain, 4);

  return (
    <figure className="grid gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}. Lavoro residuo da ${formatNumber(points[0]?.remaining ?? 0)} a ${formatNumber(points[points.length - 1]?.remaining ?? 0)} ${unitLabel}.`}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={PADDING.left + plotWidth}
              y1={y.to(tick)}
              y2={y.to(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 8}
              y={y.to(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className={cn("fill-muted-foreground", AXIS_TEXT)}
            >
              {formatNumber(tick)}
            </text>
          </g>
        ))}

        <path
          d={ideal}
          fill="none"
          className="stroke-muted-foreground/50"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />

        <path d={actual} fill="none" className="stroke-primary" strokeWidth={2.5} />

        {points.map((point, index) => (
          <circle
            key={point.at.toISOString()}
            cx={x.to(index)}
            cy={y.to(point.remaining)}
            r={3}
            className="fill-primary"
          >
            {/*
             * A single string child, deliberately.
             *
             * React 19 treats `<title>` as document metadata and renders it
             * only when it has exactly one text child. Written as
             * `{a}: {b} {c}` it has five adjacent text nodes, and the server
             * emitted `<title></title>` — empty markup, filled in only after
             * hydration, which also made every reload report a hydration
             * mismatch. Building the string first fixes both.
             */}
            <title>{`${formatShortDate(point.at)}: ${formatNumber(point.remaining)} ${unitLabel}`}</title>
          </circle>
        ))}
      </svg>

      {/*
       * Le date sono testo HTML, non etichette dentro l'SVG.
       *
       * Erano l'ultimo problema rimasto della scalatura: nell'intervallo che
       * chiamiamo «telefono» il fattore di scala passa da 0,39 a 0,75, quasi
       * il doppio, quindi *nessuna* dimensione dichiarata può essere giusta
       * per tutta la fascia. Portate fuori dall'SVG, restano alla dimensione
       * della pagina a qualunque larghezza — e si possono selezionare, che
       * un'etichetta disegnata non permette.
       *
       * L'asse verticale resta dentro: sono quattro numeri corti, che a 8,5
       * pixel si leggono ancora, e servono accanto alla griglia che etichettano.
       */}
      <div className="text-muted-foreground flex items-baseline justify-between gap-3 text-xs">
        <span>{first ? formatShortDate(first.at) : ""}</span>
        <span className="tabular-nums">
          da {formatNumber(first?.remaining ?? 0)} a {formatNumber(last?.remaining ?? 0)}{" "}
          {unitLabel}
        </span>
        <span>{last ? formatShortDate(last.at) : ""}</span>
      </div>

      <p className="text-muted-foreground text-xs">
        La linea tratteggiata è l&apos;andamento ideale dal lavoro impegnato a zero. Se
        quella continua le sta sopra, il perimetro è cresciuto o il lavoro è in ritardo.
      </p>
    </figure>
  );
}
