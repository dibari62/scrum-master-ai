import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

import { niceDomain } from "./scale";

/**
 * A horizontal bar chart, built from HTML rather than SVG.
 *
 * **It used to be an SVG, and that was a mistake.** A fixed `viewBox` of 720
 * units scaled to fit its container, so on a 375-pixel screen everything shrank
 * to 39% — the labels rendered at **3,9 pixels**, measured, which is not small
 * text but an unreadable smudge. The chart looked right on the machine it was
 * written on and was useless on a phone.
 *
 * A horizontal bar chart is a list of labelled proportions, and CSS expresses
 * proportions natively. Written this way the labels are real text at real size
 * at every width, they can be selected, they follow the reader's own font
 * settings, and a screen reader walks the list instead of meeting one opaque
 * image. Nothing was lost by giving up the SVG: the geometry was never the
 * point.
 *
 * The bars still start at zero (see `niceDomain`). A bar chart cut above zero
 * turns a five per cent difference into a visual doubling.
 */

export type Bar = {
  readonly label: string;
  /** `null` when the metric was not available: shown as absent, never as zero. */
  readonly value: number | null;
  /** Shown beside the bar; falls back to the formatted value. */
  readonly display?: string;
  /** Marks a bar that deserves attention, such as the sprint being discussed. */
  readonly highlight?: boolean;
};

type BarChartProps = {
  readonly bars: readonly Bar[];
  readonly title: string;
  readonly unitLabel?: string;
};

export function BarChart({ bars, title, unitLabel }: BarChartProps) {
  if (bars.length === 0) {
    return <p className="text-muted-foreground text-sm">Nessun dato da mostrare.</p>;
  }

  const present = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== null);

  const [, max] = niceDomain(present);

  return (
    <figure className="grid gap-2">
      <figcaption className="text-sm font-medium">{title}</figcaption>

      {/*
       * Una lista, non un'immagine.
       *
       * Un lettore di schermo la percorre voce per voce; l'SVG che c'era prima
       * offriva un solo `aria-label` per l'intero grafico, cioè il titolo e
       * nient'altro.
       */}
      <ul className="grid gap-2.5">
        {bars.map((bar) => {
          const display =
            bar.display ??
            (bar.value === null
              ? "non disponibile"
              : `${formatNumber(bar.value, 1)}${unitLabel ? ` ${unitLabel}` : ""}`);

          // Un filo di barra per uno zero vero, così resta distinguibile da un
          // valore assente, che non disegna nulla.
          const percent = bar.value === null ? 0 : Math.max((bar.value / max) * 100, 1);

          return (
            <li key={bar.label} className="grid gap-1">
              {/*
               * Su schermo stretto etichetta e valore vanno su righe diverse.
               *
               * Affiancati, «31 punti · 3 senza stima» si prendeva quasi tutta
               * la larghezza e il nome dello sprint si riduceva a «Fon…».
               * Un'etichetta troncata su un grafico è una perdita di
               * informazione, non un dettaglio estetico: senza il nome, la
               * barra non dice a cosa si riferisce.
               */}
              <div className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <span className="sm:truncate">{bar.label}</span>
                <span
                  className={cn(
                    "text-muted-foreground shrink-0 tabular-nums",
                    bar.value === null && "italic",
                  )}
                >
                  {display}
                </span>
              </div>

              {/* La traccia resta anche senza valore: una riga vuota si
                  leggerebbe come un guasto di resa. */}
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                {bar.value !== null ? (
                  <div
                    className={cn(
                      "h-full rounded-full",
                      bar.highlight ? "bg-destructive" : "bg-primary",
                    )}
                    style={{ width: `${percent}%` }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
