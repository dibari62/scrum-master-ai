import type { LlmProvider } from "@/domain";

/**
 * The price list, versioned in the repository.
 *
 * **R1 lives here.** The cost of a run is arithmetic on recorded tokens against
 * numbers a human wrote down and a reviewer can check against a published
 * price page. A model is never asked what a call cost, and never could be: it
 * has no way of knowing, and an invented figure in a cost register would be
 * indistinguishable from a real one.
 *
 * The numbers are dollars per million tokens, which is how every vendor quotes
 * them — converting at the point of writing would make the entry impossible to
 * compare against its source.
 *
 * These figures go stale. That is expected and acceptable: the register says
 * *estimated* cost, nobody reconciles a bill against it, and a stale estimate
 * that is visibly stale beats a precise one nobody maintains. What matters is
 * that changing them is a commit, visible in review.
 */

export type ProviderPricing = {
  readonly inputPerMillionUsd: number;
  readonly outputPerMillionUsd: number;
  /** When these figures were taken, so their age is visible rather than assumed. */
  readonly quotedOn: string;
};

const PER_MILLION = 1_000_000;

/**
 * Free tiers cost nothing, and saying so is not the same as not knowing.
 *
 * The paid rates are recorded anyway: the day ADR-0005 is revisited and a paid
 * plan replaces the free one — which it must, before real data — the register
 * starts showing real figures without anyone having to remember where to look
 * them up.
 */
export const PRICING: Readonly<Record<LlmProvider, ProviderPricing>> = {
  /** No network, no vendor, no cost. Zero by construction, not by rounding. */
  fake: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, quotedOn: "—" },

  gemini: { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3, quotedOn: "2026-08-22" },
  groq: { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.08, quotedOn: "2026-08-22" },
};

/**
 * Estimated cost of one run, in US dollars.
 *
 * Rounded to six decimals: a single call on a free tier costs a fraction of a
 * cent, and truncating to the cent would record every run as zero, which would
 * make the register useless exactly where it is most needed — noticing that a
 * loop has run four hundred times overnight.
 */
export function estimateCostUsd(
  provider: LlmProvider,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[provider];

  const cost =
    (inputTokens * pricing.inputPerMillionUsd + outputTokens * pricing.outputPerMillionUsd) /
    PER_MILLION;

  return Math.round(cost * 1_000_000) / 1_000_000;
}
