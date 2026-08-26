import { z } from "zod";

/**
 * Acceptance thresholds: what a place in the backlog **commits you to**.
 *
 * > «In addition to the usual product backlog, the product owner defines a list
 * > of acceptance thresholds, which is a simple classification of what the
 * > importance levels in the product backlog actually mean **in terms of the
 * > contract**.» (pag. 97)
 *
 * The book lists four rules, and it is worth quoting them because a summary
 * loses the distinction that matters:
 *
 * 1. «All items with importance >= 100 **must** be included in version 1.0, or
 *    else we'll be fined to death.»
 * 2. «All items with importance 50-99 **should** be included in version 1.0,
 *    but we might be able to get away with doing them in a quick follow-up
 *    release.»
 * 3. «Items with importance 25-49 are **required, but can be done in a
 *    follow-up release 1.1**.»
 * 4. «Items with importance < 25 are **speculative** and might never be needed
 *    at all.»
 *
 * The colour-coded figure on the same page shows only **three** colours,
 * because it merges 3 and 4 into green. We keep four, because the difference
 * between "we owe this, later" and "nobody may ever want this" is the whole
 * reason a Product Owner draws the line — and a model that merged them could
 * never tell them apart again.
 */
export const acceptanceThresholdSchema = z.enum([
  "must",
  "should",
  "later",
  "speculative",
]);

export type AcceptanceThreshold = z.infer<typeof acceptanceThresholdSchema>;

/**
 * How many backlog positions each band covers, counted from the top.
 *
 * **Positions, not scores.** The book states the rules in terms of a numeric
 * `Importance` column, which the author retracts in the second edition — and
 * he closes the loop himself, on this very page: «And you can, of course, do
 * this analysis **without having numeric importance ratings! Just order the
 * list.**»
 *
 * So a threshold is a *cut in the order*: the first `must` items are must, the
 * next `should` are should, the next `later` are later, and everything below is
 * speculative. Nothing needs a number attached to it.
 *
 * **Counts, not cumulative boundaries.** «The first five are must, the next
 * four should» is how a person says it, and it cannot express an impossible
 * state. Cumulative boundaries can — `should` below `must` — and then every
 * reader has to decide what that means.
 *
 * **Derived, never stored per item.** An item's band comes from where it sits,
 * so moving it up makes it a must with no further action. A label on the item
 * would be a second source for the same fact, and the two would disagree the
 * first time someone reordered the list without updating it.
 */
export const acceptanceThresholdCutoffsSchema = z.object({
  must: z.number().int().nonnegative(),
  should: z.number().int().nonnegative(),
  later: z.number().int().nonnegative(),
});

export type AcceptanceThresholdCutoffs = z.infer<typeof acceptanceThresholdCutoffsSchema>;

/**
 * `null` means **not declared**, and it is not the same as all-zero.
 *
 * All-zero says "nothing is committed, everything is speculative", which is a
 * statement about the contract. `null` says nobody has drawn the lines yet, and
 * the portal reports no band at all rather than colouring a whole backlog
 * green.
 */
export const acceptanceThresholdsSchema = acceptanceThresholdCutoffsSchema.nullable();

/**
 * Which band a backlog position falls in.
 *
 * The position is the **index in the ordered backlog**, zero-based, not the
 * `backlogOrder` value: an item that was never placed has no position and no
 * band, and reading its `null` as zero would make it the most binding
 * commitment in the list.
 */
export function thresholdAtPosition(
  position: number,
  cutoffs: AcceptanceThresholdCutoffs | null,
): AcceptanceThreshold | null {
  if (cutoffs === null) return null;
  if (!Number.isInteger(position) || position < 0) return null;

  if (position < cutoffs.must) return "must";
  if (position < cutoffs.must + cutoffs.should) return "should";
  if (position < cutoffs.must + cutoffs.should + cutoffs.later) return "later";

  return "speculative";
}

/**
 * What each band is called, in the words of the contract it describes.
 *
 * Deliberately not one word each: «must» alone does not say *must by when*, and
 * the whole point of a threshold is the deadline it attaches to.
 */
export const ACCEPTANCE_THRESHOLD_LABELS: Readonly<Record<AcceptanceThreshold, string>> = {
  must: "Obbligatorio nella 1.0",
  should: "Atteso nella 1.0",
  later: "Dovuto, ma in una versione successiva",
  speculative: "Ipotetico: potrebbe non servire mai",
};

/** The consequence of missing each band, which is what makes the line worth drawing. */
export const ACCEPTANCE_THRESHOLD_MEANINGS: Readonly<Record<AcceptanceThreshold, string>> = {
  must: "Se manca, il contratto è disatteso.",
  should: "Se manca, si può rimediare con un rilascio ravvicinato.",
  later: "È dovuto, ma una versione 1.1 è una consegna accettabile.",
  speculative: "Nessun impegno: potrebbe non essere mai richiesto.",
};

/** The bands in the order the backlog presents them, most binding first. */
export const ACCEPTANCE_THRESHOLD_ORDER: readonly AcceptanceThreshold[] = [
  "must",
  "should",
  "later",
  "speculative",
];
