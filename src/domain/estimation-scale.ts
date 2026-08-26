import { z } from "zod";

/**
 * The estimation scale a project declares.
 *
 * The book is emphatic that the scale is not a detail: "you can't cheat by
 * combining a 5 and a 2 to make a 7. You have to choose either 5 or 8; there is
 * no 7" (page 38). The gaps are the feature — they stop a team from pretending
 * to a precision it does not have.
 *
 * **T-shirt sizes are deliberately absent.** They would make an estimate
 * non-numeric, and velocity is a *sum* of estimates: "S + M + L" has no value.
 * Supporting them would mean a second, unsummable kind of estimate running
 * through every metric, for a scale the book never uses. If a team wants them,
 * that is an ADR, not a quiet addition here.
 */
export const estimationScaleSchema = z.enum(["planning-poker", "fibonacci", "free"]);

export type EstimationScale = z.infer<typeof estimationScaleSchema>;

/**
 * The planning poker deck of page 38.
 *
 * **Reconstructed, not transcribed** — the page carries a photograph, and the
 * text names only nine of the thirteen cards. The reconstruction and the five
 * textual constraints that force it are in `docs/scrum-dalle-trincee.md`,
 * section "Figure ricostruite — nostre, non del libro". Four values (½, 1, 3,
 * 13) are a deduction and are marked as such there.
 *
 * `?` and the coffee cup are not here: they are answers about the *estimator*
 * ("I have absolutely no idea"; "let's take a break"), not sizes of a story. In
 * the canonical model that state is `estimate: null`.
 */
export const PLANNING_POKER_DECK: readonly number[] = [
  0, 0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100,
];

/**
 * Strict Fibonacci, for teams that use it instead of the rounded deck.
 *
 * It diverges from planning poker above 13 — 21, 34, 55, 89 against 20, 40,
 * 100 — which is precisely why the two are separate scales and not one with a
 * tolerance.
 */
export const FIBONACCI_SCALE: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/**
 * The values each scale admits, or `null` for "no scale declared".
 *
 * `free` is the default and is not a lesser option: a project that has not
 * declared a scale is different from one that declared "anything goes", and
 * both read as "do not report deviations". Inventing a scale nobody chose would
 * fill the portal with warnings about a rule the team never adopted.
 */
export const ESTIMATION_SCALE_VALUES: Readonly<
  Record<EstimationScale, readonly number[] | null>
> = {
  "planning-poker": PLANNING_POKER_DECK,
  fibonacci: FIBONACCI_SCALE,
  free: null,
};

export const DEFAULT_ESTIMATION_SCALE: EstimationScale = "free";

/**
 * Whether a value is one the declared scale admits.
 *
 * A `free` scale admits everything, so this is `true` for any finite value.
 *
 * **Only points are checked.** A team estimating in hours is not playing
 * planning poker — "3 hours" is a duration, and the deck's gaps carry no
 * meaning there. The same restriction that ADR-0008 puts on the focus factor,
 * for the same reason: a rule applied where it does not hold produces confident
 * nonsense.
 */
export function isOnScale(
  scale: EstimationScale,
  estimate: { readonly value: number; readonly unit: string } | null,
): boolean {
  if (estimate === null) return true;
  if (estimate.unit !== "points") return true;

  const allowed = ESTIMATION_SCALE_VALUES[scale];
  if (allowed === null) return true;

  return allowed.includes(estimate.value);
}

/**
 * The two admitted values a rejected estimate sits between.
 *
 * The book's own way of refusing a 7 is to name the alternatives — "you have to
 * choose either 5 or 8". An error that says only "not allowed" leaves the
 * reader to go and find the deck; this one hands them the two cards.
 *
 * Returns `null` when the value is admitted, when no scale is declared, or when
 * the value sits above the largest card — beyond 100 there is no upper
 * neighbour to name, and the book says as much about the gap below it.
 */
export function neighboursOnScale(
  scale: EstimationScale,
  value: number,
): { readonly below: number; readonly above: number } | null {
  const allowed = ESTIMATION_SCALE_VALUES[scale];
  if (allowed === null) return null;
  if (allowed.includes(value)) return null;

  let below: number | undefined;
  let above: number | undefined;

  for (const candidate of allowed) {
    if (candidate < value) below = candidate;
    if (candidate > value && above === undefined) above = candidate;
  }

  if (below === undefined || above === undefined) return null;

  return { below, above };
}

/** How a scale is named to a reader. */
export const ESTIMATION_SCALE_LABELS: Readonly<Record<EstimationScale, string>> = {
  "planning-poker": "Planning poker",
  fibonacci: "Fibonacci",
  free: "Nessuna scala dichiarata",
};
