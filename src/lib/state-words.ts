import type { WorkItemState } from "@/domain";

/**
 * The canonical states, in words a reader recognises.
 *
 * **Why they are here and not in each page.** The same table was written out in
 * three pages, and now a skill needs it too: an agent that narrates where work
 * piles up must call the phase by the name the screen beside it uses. Four
 * copies of one vocabulary are four chances for the narration to say «In
 * revisione» where the table says something else, and a reader who notices that
 * stops trusting both.
 *
 * `src/lib` because it is the only layer both `src/app` and `src/agents` may
 * import (AGENTS.md §4). Not in `src/domain`: these are words chosen for a
 * reader, while the domain holds the identifiers.
 */
export const STATE_LABELS: Readonly<Record<WorkItemState, string>> = {
  todo: "Da fare",
  in_progress: "In lavorazione",
  in_review: "In revisione",
  blocked: "Bloccato",
  done: "Concluso",
  cancelled: "Annullato",
};
