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
 * ## What this guarantees, and what it does not
 *
 * It guarantees that **no new quantity appears**, and that a quantity is not
 * moved onto a unit it was never measured in. It does **not** understand which
 * metric a sentence is about: «la velocity è stata di 2,8 giorni» is refused
 * because no velocity was measured in days, but a text attributing a correct
 * day-figure to the wrong duration would pass. Closing that means having the
 * model return structured references instead of prose, and is recorded as future
 * work rather than quietly claimed here.
 *
 * One further hole, stated because a silent one is worse: numbers written as
 * words («trentuno») or in Roman numerals carry no digits and are invisible to
 * this check.
 */

/**
 * Units a report can attach to a figure.
 *
 * Their purpose is attribution, not decoration: a number may appear with a unit
 * only if the code produced that exact pairing. Without this, every figure in
 * the snapshot would be quotable as any kind of quantity — «31 giorni» where
 * what was measured was «31 punti».
 */
const UNIT_WORDS = [
  "giorni",
  "giorno",
  "ore",
  "ora",
  "minuti",
  "minuto",
  "min",
  "secondi",
  "ms",
  "punti",
  "punto",
  "elementi",
  "elemento",
  "per cento",
] as const;

/**
 * A number, in either of the two conventions a bilingual pipeline produces.
 *
 * The grouped form comes first in the alternation so that «1.234» reads as one
 * thousand rather than as a decimal. Getting that order wrong is how «1.000
 * elementi» becomes the harmless-looking token `1`.
 *
 * The sign is part of the token: «-31» and «31» are different claims, and a
 * check that conflated them would let a report invert a figure for free.
 */
const NUMBER_PATTERN = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g;

const GROUPED = /^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;

/**
 * A numeric token reduced to a form that compares across writing styles.
 *
 * Italian writes «2,8» and groups thousands with dots; JSON and code write
 * «2.8». Both arrive, because a model asked for Italian prose produces a mix.
 * Normalising to a value rather than insisting on one spelling means the check
 * tests the *quantity*, not the typography — while keeping «1.234» (one
 * thousand) and «1,234» (one and a bit) apart, which they are.
 */
export function normaliseNumber(token: string): string {
  const negative = token.startsWith("-");
  const body = negative ? token.slice(1) : token;

  const plain = GROUPED.test(body)
    ? body.replaceAll(".", "").replace(",", ".")
    : body.replace(",", ".");

  const trimmed = plain.includes(".") ? plain.replace(/0+$/, "").replace(/\.$/, "") : plain;

  const withoutLeadingZeros = trimmed.replace(/^0+(?=\d)/, "");
  return negative && withoutLeadingZeros !== "0"
    ? `-${withoutLeadingZeros}`
    : withoutLeadingZeros;
}

/** Every numeric token in a piece of text, normalised. */
export function numericTokens(text: string): readonly string[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((match) => normaliseNumber(match[0]));
}

/**
 * The unit that follows a figure, if any.
 *
 * `%` may sit flush against the number; a word needs a space. Anything else
 * means the figure was written bare, which is allowed: a sentence may quote a
 * number and name its unit in words elsewhere.
 */
function unitAfter(text: string, endIndex: number): string | null {
  const rest = text.slice(endIndex);

  if (rest.startsWith("%")) return "%";

  const match = /^\s+([a-zà-ù]+(?:\s+[a-zà-ù]+)?)/i.exec(rest);
  if (!match?.[1]) return null;

  const candidate = match[1].toLowerCase();

  for (const unit of UNIT_WORDS) {
    if (candidate === unit || candidate.startsWith(`${unit} `)) {
      return unit === "per cento" ? "%" : unit;
    }
  }

  return null;
}

/** Whether the figure is an ordinal — «all'85° percentile» — not a measurement. */
function isOrdinal(text: string, endIndex: number): boolean {
  return text.slice(endIndex).startsWith("°");
}

type Allowed = {
  readonly numbers: ReadonlySet<string>;
  /** `value|unit`, so a figure cannot migrate onto a unit it never had. */
  readonly pairs: ReadonlySet<string>;
};

/*
 * Numbers appearing in a metric's *label* are deliberately not admitted.
 *
 * «Cycle time all'85°» would otherwise make a bare 85 quotable as any quantity
 * at all, and a report claiming a velocity of 85 punti would pass. Ordinals are
 * recognised by the `°` that follows them instead, which lets the label be
 * written without letting the number loose.
 */
function allowedFrom(values: readonly CitableValue[]): Allowed {
  const numbers = new Set<string>();
  const pairs = new Set<string>();

  for (const value of values) {
    for (const match of value.text.matchAll(NUMBER_PATTERN)) {
      const token = normaliseNumber(match[0]);
      numbers.add(token);

      const unit = unitAfter(value.text, match.index + match[0].length);
      if (unit) pairs.add(`${token}|${unit}`);
    }
  }

  return { numbers, pairs };
}

export type FidelityResult =
  | { readonly faithful: true }
  | {
      readonly faithful: false;
      /**
       * The offending figures, as they appeared.
       *
       * Reported rather than merely counted: «il report cita 47» tells whoever
       * reads the register what happened, and a bare `false` does not.
       */
      readonly strangers: readonly string[];
    };

/**
 * Checks a text against the values the code made available.
 *
 * Every figure must be one of them and, when the text names a unit, must carry
 * the unit it was measured in.
 *
 * `quotableNames` covers the proper names a report has to be able to write —
 * «Sprint 4», a project called «Checkout 2». The digits in them are not
 * measurements and refusing them would reject correct reports over a naming
 * convention. They are admitted as bare numbers only: «Sprint 4» does not make
 * «4 giorni» sayable, because the unit is still checked against what was
 * actually measured.
 *
 * **There is no allowance for "small" numbers.** An earlier version let anything
 * from zero to ten through as ordinary prose, on the argument that «restano
 * aperti 3 elementi» should not be refused. The argument was wrong: with an
 * empty snapshot that version accepted «il cycle time è 10 giorni, la velocity 9
 * punti e l'efficienza 8%» — three inventions, none computed. If a count belongs
 * in a report, the code supplies it.
 */
export function checkNumericFidelity(
  text: string,
  values: readonly CitableValue[],
  quotableNames: readonly string[] = [],
): FidelityResult {
  const allowed = allowedFrom(values);
  const fromNames = new Set<string>();

  for (const name of quotableNames) {
    for (const token of numericTokens(name)) fromNames.add(token);
  }

  const strangers: string[] = [];

  const reject = (raw: string): void => {
    if (!strangers.includes(raw)) strangers.push(raw);
  };

  for (const match of text.matchAll(NUMBER_PATTERN)) {
    const raw = match[0];
    const end = match.index + raw.length;

    if (isOrdinal(text, end)) continue;

    const token = normaliseNumber(raw);
    const unit = unitAfter(text, end);

    if (!allowed.numbers.has(token)) {
      // A name may be written, but only as a name: with a unit attached it is
      // being used as a measurement, and no measurement backs it.
      if (fromNames.has(token) && !unit) continue;

      reject(raw);
      continue;
    }

    if (unit && !allowed.pairs.has(`${token}|${unit}`)) reject(`${raw} ${unit}`);
  }

  return strangers.length === 0 ? { faithful: true } : { faithful: false, strangers };
}
