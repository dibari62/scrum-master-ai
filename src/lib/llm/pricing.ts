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

  /**
   * Zero, ed è la verità e non un'omissione.
   *
   * Ollama gira sulla macchina del cliente: non c'è un fornitore che fatturi
   * nulla. Il costo esiste — corrente elettrica, un computer acceso — ma non è
   * misurabile in dollari per milione di token, e inventare una cifra qui la
   * farebbe comparire in un registro dei costi accanto a numeri che invece
   * corrispondono a una fattura.
   */
  ollama: { inputPerMillionUsd: 0, outputPerMillionUsd: 0, quotedOn: "—" },

  gemini: { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.3, quotedOn: "2026-08-22" },
  groq: { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.08, quotedOn: "2026-08-22" },

  // Le tariffe del modello predefinito di ciascuno, non del più capace: è quello
  // che un progetto userà se non sceglie, e quindi quello che pagherà.
  openai: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6, quotedOn: "2026-08-27" },
  anthropic: { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4, quotedOn: "2026-08-27" },
  mistral: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3, quotedOn: "2026-08-27" },

  /**
   * Una stima, e va detto che lo è più delle altre.
   *
   * OpenRouter è un aggregatore: il prezzo dipende dal modello scelto, e sotto
   * ci sono centinaia di modelli che vanno da zero a due ordini di grandezza in
   * più. La cifra qui è quella del predefinito; per qualunque altro modello il
   * registro riporterà un costo indicativo e nulla di più, il che è già ciò che
   * la parola «stimato» promette.
   */
  openrouter: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4, quotedOn: "2026-08-27" },
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
