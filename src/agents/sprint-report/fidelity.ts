import type { CitableValue } from "@/domain";

/**
 * Whether every number in a generated text is one the code produced.
 *
 * **Why this exists at all.** Telling a model "do not calculate anything" is an
 * instruction, and an instruction is something a model may follow. This is the
 * check that makes it something it *must* follow: the set of quotable figures is
 * closed and known, so a number in the prose that is not in that set was either
 * invented or worked out by the model. Either way the report is wrong in the
 * most dangerous way available — confidently, in a document somebody forwards.
 *
 * The rule is deliberately blunt: extract every numeric token, compare against
 * the allowed set, refuse on any stranger. A cleverer check that understood
 * context would be a check that could be argued with.
 */

/**
 * Numbers a report may contain without coming from a metric.
 *
 * Small integers are unavoidable in ordinary prose — «i due elementi rimasti
 * aperti», «il primo dei tre» — and forbidding them would reject correct
 * reports. They are capped low: a figure large enough to be mistaken for a
 * measurement is never free.
 *
 * Kept explicit rather than derived from a rule about magnitude, so that
 * widening it is a decision somebody writes down.
 */
const ALWAYS_ALLOWED = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

/**
 * Matches a run of digits with an optional decimal part, either separator.
 *
 * Both separators are accepted because the two sides disagree: Italian prose
 * writes «2,8», JSON and code write `2.8`, and a model asked for Italian will
 * produce a mix. Normalising here rather than insisting on one form means the
 * check tests the *value*, not the typography.
 */
const NUMBER_PATTERN = /\d+(?:[.,]\d+)?/g;

/** A numeric token reduced to a form that compares across writing styles. */
function normalise(token: string): string {
  const withDot = token.replace(",", ".");

  // «2.80» and «2,8» are the same measurement written twice. Trailing zeros
  // after the point carry no information and would otherwise read as a stranger.
  const trimmed = withDot.includes(".")
    ? withDot.replace(/0+$/, "").replace(/\.$/, "")
    : withDot;

  // Leading zeros likewise: «07» and «7» are one number.
  return trimmed.replace(/^0+(?=\d)/, "");
}

/** Every numeric token in a piece of text, normalised. */
export function numericTokens(text: string): readonly string[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => normalise(match[0]));
}

export type FidelityResult =
  | { readonly faithful: true }
  | {
      readonly faithful: false;
      /**
       * The offending tokens, as they appeared.
       *
       * Reported rather than merely counted: «il report cita 47» tells whoever
       * reads the register what happened, and a bare `false` does not.
       */
      readonly strangers: readonly string[];
    };

/**
 * Checks a text against the values the code made available.
 *
 * A token counts as known when it appears anywhere among the citable values, so
 * «2,8 giorni» in the report matches the snapshot's «2,8 giorni» and «il cycle
 * time è 2,8» does too. Matching on tokens rather than whole phrases is
 * intentional: demanding the phrase would reject a model that reworded correctly
 * around a correct number, which is exactly what it is being asked to do.
 */
export function checkNumericFidelity(
  text: string,
  values: readonly CitableValue[],
): FidelityResult {
  const allowed = new Set(ALWAYS_ALLOWED);

  for (const value of values) {
    for (const token of numericTokens(value.text)) allowed.add(token);
    // Labels can carry numbers too — «Cycle time all'85°» — and a report that
    // names the metric it is quoting must be able to say its name.
    for (const token of numericTokens(value.label)) allowed.add(token);
  }

  const strangers: string[] = [];
  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const token = normalise(match[0]);
    if (!allowed.has(token) && !strangers.includes(match[0])) strangers.push(match[0]);
  }

  return strangers.length === 0 ? { faithful: true } : { faithful: false, strangers };
}
