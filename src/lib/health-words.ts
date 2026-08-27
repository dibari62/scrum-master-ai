/**
 * The words for a sprint's health, in one place.
 *
 * **Why they moved out of the page.** The dashboard prints a verdict and the
 * five signal titles; the `sprint-health` skill now has to hand the same verdict
 * and the same titles to a model. Copying them would create two vocabularies for
 * one judgement, free to drift apart — and the drift would show up as a
 * narration calling «Sereno» what the banner beside it calls «Critico», which is
 * worse than either wording being wrong on its own.
 *
 * They live in `src/lib` because it is the only layer both `src/app` and
 * `src/agents` are allowed to import (AGENTS.md §4). They are deliberately not
 * in `src/domain`: these are words chosen for a reader, not part of the
 * canonical model.
 */

/** The six signals, named for a reader rather than by their identifier. */
export const SIGNAL_TITLES = {
  progress: "Avanzamento",
  "scope-added": "Lavoro aggiunto dopo l'inizio",
  "review-wait": "Attesa in revisione",
  "wip-limit": "Limite di lavoro in corso",
  aging: "Elementi fermi",
  unowned: "Lavoro che nessuno ha in carico",
} as const;

/** The verdict itself, said in words rather than carried by a colour. */
export const VERDICT_WORDS = {
  respected: {
    label: "Sereno",
    summary: "Nessuno dei segnali osservati supera la propria soglia.",
  },
  watch: {
    label: "Da tenere d'occhio",
    summary: "Qualcosa si sta muovendo nella direzione sbagliata, ma c'è tempo per intervenire.",
  },
  critical: {
    label: "Critico",
    summary: "Almeno un segnale è ben oltre la soglia: vale la pena parlarne oggi.",
  },
  "not-evaluable": {
    label: "Non valutabile",
    summary:
      "Non ci sono abbastanza dati per dire come sta andando. Non è un giudizio positivo: è l'assenza di un giudizio.",
  },
} as const;
