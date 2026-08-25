import { z } from "zod";

/**
 * An answer to a free question about a project.
 *
 * **Why citations are part of the shape and not a nicety.** Every other skill
 * produces text that sits beside the figures it describes, so a reader can check
 * it by looking up. A free answer has nothing beside it: without saying which
 * items it was built from, it asks to be believed. The citations are what turn
 * it back into something verifiable.
 */

export const projectAnswerSchema = z.object({
  /** The answer itself. */
  answer: z.string().min(20).max(1500),
  /**
   * The sources used, by their position in the list the code supplied.
   *
   * Indices rather than titles: a title can be paraphrased, mistyped or
   * invented, while an index either points at something that was shown or it
   * does not. Empty only when `unknown` is true.
   */
  citations: z.array(z.number().int().nonnegative()).max(20).readonly(),
  /**
   * Whether the answer is an admission of not knowing.
   *
   * Declared rather than guessed from the prose: «non risulta nulla» and «non ho
   * trovato nulla di rilevante» are the same admission written two ways, and a
   * check reading the sentence would have to understand it. Asking for the flag
   * makes the one legitimate uncited answer explicit.
   */
  unknown: z.boolean(),
});

export type ProjectAnswer = z.infer<typeof projectAnswerSchema>;
