import { z } from "zod";

import { workItemStateSchema } from "./work-item";

/**
 * Explaining where work piles up.
 *
 * The measurement lives in `src/metrics/bottleneck.ts` and is not this file's
 * business (R1). What is declared here is the shape a narration must take, so
 * an answer that drifts can be refused instead of shown.
 */

/**
 * One reading, tied to the phase it reads.
 *
 * Anchored to a canonical state rather than to free text: a sentence about «la
 * fase di verifica» cannot be checked against anything, while one anchored to
 * `in_review` can be put beside the figure the code measured for it.
 */
export const stageObservationSchema = z.object({
  state: workItemStateSchema,
  observation: z.string().min(20).max(500),
});

export type StageObservation = z.infer<typeof stageObservationSchema>;

/**
 * What the model must return when it explains the flow.
 *
 * **`worstWait` is a state, not a sentence, and that is the whole safeguard.**
 * The engine already decided which waiting phase absorbs the most time, and it
 * chooses **only among waits** — calling the work itself the bottleneck would
 * tell a team that the obstacle to finishing is doing the job. Letting the model
 * name the phase in prose would put that decision back in its hands; letting it
 * return the identifier means the answer can be compared with the one the code
 * reached, and refused when they disagree.
 */
export const bottleneckNarrativeSchema = z.object({
  /** Where the time goes, for someone who has not seen the table. */
  situation: z.string().min(80).max(1200),
  /**
   * The phase the narration presents as the bottleneck.
   *
   * Absent when the code found no waiting phase: there is nothing to name, and
   * naming the least bad thing would promote it to a problem.
   */
  worstWait: workItemStateSchema.optional(),
  /** At most three: an explanation of every phase is the table again, in prose. */
  observations: z.array(stageObservationSchema).max(3).readonly(),
});

export type BottleneckNarrative = z.infer<typeof bottleneckNarrativeSchema>;
