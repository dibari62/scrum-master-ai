import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { SIGNAL_TITLES as HEALTH_SIGNAL_TITLES } from "@/lib/health-words";
import type { HealthSignal, MetricResult } from "@/metrics";

/**
 * Turning metric results into the strings a component can display.
 *
 * Lives in `src/app` because it is the translation between two layers that must
 * not know each other: `src/metrics` produces results, `src/components` draws
 * strings, and Â§4 forbids the second from importing the first. The adapter has
 * to sit somewhere, and the page is the only place allowed to see both.
 *
 * It is also where rounding happens â€” the metrics engine keeps full precision
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
  "mixed-estimate-units": "unitÃ  di stima diverse, non sommabili",
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
 * Why a metric has no value, in words. `null` when it has one.
 *
 * For the views where the wording of `present` does not fit. A count of items
 * in a sprint rests on movements of the sprint's composition, not on items, so
 * "su 24 elementi" printed beside "12 elementi" would read as a contradiction
 * rather than as a sample size. The absent case is identical everywhere, and it
 * is the case that must never silently become a zero.
 */
export function unavailableReason(result: MetricResult<unknown>): string | null {
  return result.available ? null : REASONS[result.reason];
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
    ? `${base} Â· ${formatNumber(totals.unestimatedCount)} senza stima`
    : base;
}

/**
 * The sprint-health signals, in words a reader can act on.
 *
 * **The colour is never the message.** A signal that only shows as red tells
 * somebody who cannot distinguish red from green â€” or who is listening to the
 * page rather than looking at it â€” precisely nothing. So every outcome carries
 * a sentence, and the sentence is what the tests check.
 *
 * The wording is deliberately specific about *how far past* the threshold the
 * measurement is. "Oltre il limite" invites a shrug; "il doppio del limite che
 * il team si Ã¨ dato" does not.
 */
export type PresentedSignal = {
  readonly title: string;
  /** Why it reads this way, in one sentence. */
  readonly explanation: string;
  /** The measurement and the threshold, side by side. `null` when unknown. */
  readonly figures: string | null;
};

const SIGNAL_TITLES = HEALTH_SIGNAL_TITLES;

export function presentSignal(signal: HealthSignal): PresentedSignal {
  const title = SIGNAL_TITLES[signal.id];

  if (signal.status === "not-evaluable") {
    return {
      title,
      // CiÃ² che manca si dice, non si lascia indovinare (R6): Â«non valutabileÂ»
      // da solo sposta sul lettore il compito di capire perchÃ©.
      explanation: `Non valutabile: ${signal.missing ?? "manca il dato necessario"}.`,
      figures: null,
    };
  }

  const measured = signal.measured ?? 0;
  const threshold = signal.threshold ?? 0;

  switch (signal.id) {
    case "progress":
      return {
        title,
        explanation:
          signal.status === "respected"
            ? "Il lavoro concluso tiene il passo del tempo trascorso."
            : `Il lavoro concluso Ã¨ al ${formatPercent(measured)} di dove il calendario lo vorrebbe.`,
        figures: `${formatPercent(measured)} del passo atteso Â· soglia ${formatPercent(threshold)}`,
      };

    case "scope-added":
      return {
        title,
        explanation:
          signal.status === "respected"
            ? "Poco lavoro Ã¨ entrato dopo che lo sprint era cominciato."
            : `Dopo l'inizio Ã¨ entrato lavoro pari al ${formatPercent(measured)} dell'impegno iniziale.`,
        figures: `${formatPercent(measured)} dell'impegno Â· soglia ${formatPercent(threshold)}`,
      };

    case "review-wait":
      return {
        title,
        explanation:
          signal.status === "respected"
            ? "La revisione scorre come negli sprint conclusi."
            : `La revisione sta impiegando ${formatNumber(measured, 1)} volte il tempo abituale di questa squadra.`,
        figures: `${formatNumber(measured, 1)}Ã— l'abitudine Â· soglia ${formatNumber(threshold, 1)}Ã—`,
      };

    case "wip-limit":
      return {
        title,
        explanation:
          signal.status === "respected"
            ? "Nessuna colonna supera il limite che il team si Ã¨ dato."
            : `Una colonna contiene ${formatNumber(measured, 1)} volte il limite che il team si Ã¨ dato.`,
        figures: `${formatNumber(measured, 1)}Ã— il limite dichiarato`,
      };

    case "aging":
      return {
        title,
        explanation:
          signal.status === "respected"
            ? "Gli elementi aperti sono fermi da un tempo normale per questo progetto."
            : `Il ${formatPercent(measured)} degli elementi aperti Ã¨ fermo da piÃ¹ di quanto questo progetto impieghi di solito.`,
        figures: `${formatPercent(measured)} degli elementi aperti Â· soglia ${formatPercent(threshold)}`,
      };
  }
}

/**
 * The verdict and the signal titles now live in `src/lib/health-words`.
 *
 * Re-exported here so the pages that already import them keep working, and so
 * there is still one obvious place to look. The definition moved because the
 * `sprint-health` skill needs the same words and `src/agents` cannot import from
 * `src/app` (Â§4).
 */
export { VERDICT_WORDS } from "@/lib/health-words";


/**
 * La serie da disegnare per un burndown, e in quale unità.
 *
 * **La regola viene dal libro, e il portale non la applicava.**
 *
 * > «If you don't have time estimates on the tasks, you can still do a burndown
 * > — **just count the tasks instead of adding up the hours**» (pag. 66)
 *
 * Le due pagine che disegnano un burndown scrivevano `remaining.points ?? 0`.
 * Su uno sprint senza stime in punti questo non produce «nessun grafico»:
 * produce **una linea piatta a zero**, cioè uno sprint che sembra concluso il
 * primo giorno. È peggio dell'assenza, perché ha l'aspetto di un'informazione.
 *
 * Dichiarata qui e non nelle due pagine perché è una decisione sola: duplicarla
 * significherebbe che fra sei mesi la panoramica e la pagina sprint disegnano lo
 * stesso sprint in due modi diversi.
 *
 * L'ordine delle preferenze è quello del libro: prima i punti, poi le ore, e in
 * ultimo il conteggio — che è sempre disponibile, perché contare non richiede
 * che qualcuno abbia stimato.
 */
export type BurndownPresentation = {
  readonly series: readonly { readonly at: Date; readonly remaining: number }[];
  readonly committed: number;
  readonly unitLabel: string;
  /** Vero quando si contano gli elementi: la schermata lo dichiara. */
  readonly counted: boolean;
};

export function presentBurndown(burndown: {
  readonly points: readonly {
    readonly at: Date;
    readonly remaining: { readonly points: number | null; readonly hours: number | null };
    readonly openCount: number;
    readonly ideal: number | null;
  }[];
}): BurndownPresentation {
  const first = burndown.points[0];

  const measuredIn =
    first?.remaining.points !== null && first?.remaining.points !== undefined
      ? "points"
      : first?.remaining.hours !== null && first?.remaining.hours !== undefined
        ? "hours"
        : "count";

  if (measuredIn === "count") {
    return {
      series: burndown.points.map((point) => ({ at: point.at, remaining: point.openCount })),
      /*
       * La linea ideale parte dal numero di elementi del primo giorno.
       *
       * `ideal` è calcolato in punti e qui sarebbe `null`: usarlo lascerebbe il
       * grafico senza guida proprio nel caso in cui la guida è più utile, perché
       * un conteggio non ha una scala che chi guarda già conosce.
       */
      committed: burndown.points[0]?.openCount ?? 0,
      unitLabel: "elementi",
      counted: true,
    };
  }

  const value = (point: (typeof burndown.points)[number]): number =>
    (measuredIn === "points" ? point.remaining.points : point.remaining.hours) ?? 0;

  return {
    series: burndown.points.map((point) => ({ at: point.at, remaining: value(point) })),
    committed: burndown.points[0]?.ideal ?? value(burndown.points[0] ?? ({} as never)) ?? 0,
    unitLabel: measuredIn === "points" ? "punti" : "ore",
    counted: false,
  };
}
