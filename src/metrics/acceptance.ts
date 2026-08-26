import {
  ACCEPTANCE_THRESHOLD_ORDER,
  thresholdAtPosition,
  type AcceptanceThreshold,
  type AcceptanceThresholdCutoffs,
  type WorkItem,
} from "@/domain";

import { totalEstimates, type EstimateTotals } from "./estimates";

/**
 * How much work each acceptance band holds.
 *
 * > «All items with importance >= 100 **must** be included in version 1.0, or
 * > else we'll be fined to death.» (pag. 97)
 *
 * The bands say what is owed; this says **how much it costs**. Without the
 * second number the first is a promise with no price attached, and the whole
 * point of drawing the line before a deadline is to find out whether the
 * binding part fits.
 *
 * Pure and I/O-free like the rest of the engine, and it never reads the clock.
 */

export interface AcceptanceBand {
  readonly threshold: AcceptanceThreshold;
  readonly itemCount: number;

  /**
   * The work in this band, split by estimate unit.
   *
   * Split and never one number: points and hours must not be summed together
   * (`EstimateTotals`), and a contract is exactly the wrong place to blur that.
   */
  readonly total: EstimateTotals;
}

export interface AcceptanceCoverage {
  readonly bands: readonly AcceptanceBand[];

  /**
   * Items the bands could not classify.
   *
   * An item with no position is not speculative — nobody has placed it — so it
   * belongs to no band. Counting it as the least binding one would quietly turn
   * "not decided" into "decided against".
   */
  readonly unclassified: number;
}

/**
 * Splits an **already ordered** backlog into its acceptance bands.
 *
 * The caller passes the list in backlog order — `productBacklog` produces it —
 * because the band comes from the position, and a function that re-sorted here
 * would be a second place where the order is decided.
 *
 * Every band appears in the result, including empty ones. A band that vanished
 * when it held nothing would make "we committed to nothing in 1.0" look
 * identical to "we never drew that line", and those are opposite statements.
 */
export function acceptanceCoverage(
  orderedBacklog: readonly WorkItem[],
  cutoffs: AcceptanceThresholdCutoffs | null,
): AcceptanceCoverage {
  const byBand = new Map<AcceptanceThreshold, WorkItem[]>(
    ACCEPTANCE_THRESHOLD_ORDER.map((threshold) => [threshold, []]),
  );

  let unclassified = 0;

  for (const [position, entry] of orderedBacklog.entries()) {
    /*
     * Senza posizione non c'è fascia.
     *
     * `productBacklog` mette in fondo gli elementi mai collocati, quindi
     * l'indice esiste comunque — ma un indice non è una collocazione. Usarlo
     * classificherebbe come «ipotetico» qualcosa che nessuno ha ancora deciso.
     */
    if (entry.backlogOrder === null) {
      unclassified += 1;
      continue;
    }

    const threshold = thresholdAtPosition(position, cutoffs);
    if (threshold === null) {
      unclassified += 1;
      continue;
    }

    byBand.get(threshold)?.push(entry);
  }

  return {
    bands: ACCEPTANCE_THRESHOLD_ORDER.map((threshold) => {
      const items = byBand.get(threshold) ?? [];

      return {
        threshold,
        itemCount: items.length,
        total: totalEstimates(items),
      };
    }),
    unclassified,
  };
}
