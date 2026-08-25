import { z } from "zod";

/**
 * The daily digest: what moved, what came back, what stood still.
 *
 * The counting happens in `src/metrics/daily.ts` (R1). What this file declares
 * is the shape the narration must take — and one obligation that is easy to
 * state and easy to lose: **the part about what did not move is not optional**.
 */

export const digestNarrativeSchema = z.object({
  /** The day in one or two sentences, for somebody who reads nothing else. */
  headline: z.string().min(40).max(400),
  /** What actually advanced. */
  movement: z.string().min(40).max(900),
  /**
   * What stood still, was blocked, or came back.
   *
   * Required whenever the code found anything standing still, and refused when
   * it is missing. A digest that reports only progress is not a shorter digest:
   * it is a different, reassuring one — and the items nobody touched are
   * precisely what a daily reading exists to surface.
   */
  standstill: z.string().min(40).max(900).optional(),
});

export type DigestNarrative = z.infer<typeof digestNarrativeSchema>;
