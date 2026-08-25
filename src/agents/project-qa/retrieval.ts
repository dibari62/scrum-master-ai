import type { WorkItem, WorkItemId } from "@/domain";

/**
 * Choosing which items the model is allowed to see.
 *
 * **This is the most consequential file of the skill, and the least glamorous.**
 * Whatever ends up here is what the answer can be built from; whatever does not
 * is invisible to it. §9 requires the selection to be deterministic — the model
 * receives the twenty relevant items chosen by code, never four thousand rows —
 * and this is also what keeps the answer auditable: it can be said *why* an item
 * was shown, which is not true of a vector distance.
 *
 * Pure and I/O-free, so the selection can be tested without a database.
 */

/** Words too common to carry meaning in a question about a project. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "il","lo","la","i","gli","le","un","uno","una","di","a","da","in","con","su","per","tra","fra",
  "e","o","ma","che","chi","cosa","come","quando","dove","perche","perché","quale","quali",
  "del","della","dei","delle","dello","degli","al","allo","alla","ai","agli","alle","dal","dalla",
  "nel","nella","nei","negli","nelle","sul","sulla","sui","è","e'","sono","stato","stata","essere",
  "ci","si","non","piu","più","meno","molto","questo","questa","questi","queste","c'e","c'è",
]);

/**
 * Reduces a text to comparable terms.
 *
 * Accents are folded and case dropped so «però» and «pero» meet; punctuation is
 * dropped so «carrello.» matches «carrello». Nothing clever happens here on
 * purpose: a stemmer that turned «spedizione» into «sped» would make the
 * selection harder to explain, and explainability is the point.
 */
export function terms(text: string): readonly string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

export type ScoredSource = {
  readonly workItemId: WorkItemId;
  readonly title: string;
  readonly description: string | null;
  /** How many distinct question terms this item matched. */
  readonly score: number;
  /** The terms that matched, so the choice can be explained. */
  readonly matched: readonly string[];
};

/**
 * The ceiling from the spec (§9, criterio Q2).
 *
 * Twenty is a judgement, not a measurement, and it is written once here rather
 * than repeated at call sites.
 */
export const MAX_SOURCES = 20;

/**
 * Selects the items worth showing, best first.
 *
 * An item matches on its title **and** its description, but a title match counts
 * double: a word in a title is what the item is about, while the same word in a
 * long description may be an aside. Items matching nothing are left out rather
 * than ranked last — padding the list with irrelevant material is how a model
 * ends up quoting something unrelated with confidence.
 */
export function selectSources(
  question: string,
  items: readonly WorkItem[],
): readonly ScoredSource[] {
  const wanted = new Set(terms(question));
  if (wanted.size === 0) return [];

  const scored: ScoredSource[] = [];

  for (const item of items) {
    const titleTerms = new Set(terms(item.title));
    const bodyTerms = new Set(item.description === null ? [] : terms(item.description));

    const matched: string[] = [];
    let score = 0;

    for (const term of wanted) {
      const inTitle = titleTerms.has(term);
      const inBody = bodyTerms.has(term);

      if (!inTitle && !inBody) continue;

      matched.push(term);
      score += inTitle ? 2 : 1;
    }

    if (score > 0) {
      scored.push({
        workItemId: item.id,
        title: item.title,
        description: item.description,
        score,
        matched,
      });
    }
  }

  /*
   * A parità di punteggio si ordina per identificativo.
   *
   * Non è pignoleria: senza un secondo criterio l'ordine dipenderebbe da quello
   * in cui il database ha restituito le righe, e due esecuzioni identiche
   * potrebbero mostrare fonti diverse al modello. Una risposta irriproducibile
   * non si può verificare.
   */
  scored.sort((left, right) =>
    right.score === left.score
      ? left.workItemId.localeCompare(right.workItemId)
      : right.score - left.score,
  );

  return scored.slice(0, MAX_SOURCES);
}
