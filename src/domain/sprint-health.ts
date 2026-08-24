import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { sprintHealthCheckIdSchema, sprintIdSchema } from "./ids";

/**
 * A judgement on a running sprint, kept.
 *
 * **Why this is stored at all.** Everything else in the application is computed
 * when somebody looks: the dashboard works out the sprint's health at the
 * moment the page opens. The consequence is that there is no *history* — the
 * health is always and only today's, because looking is the only thing that
 * ever causes it to be calculated.
 *
 * The `sprint-health` increment deliberately deferred persistence, with a good
 * argument: storing something before knowing what it is for means designing a
 * table for a question nobody has asked. The question is now asked, and it is
 * **"how has this changed"** — which on-demand calculation can never answer.
 *
 * **On the name.** The roadmap says `Insight` and `Alert`. Those name an
 * ambition rather than a content: this holds a verdict on one sprint at one
 * instant, and saying so makes the table readable without guessing. A generic
 * name invites anything to be put in it, which is how a table becomes a
 * dumping ground.
 */

/**
 * The verdict, using the same words as the engine that produces it.
 *
 * Deliberately not translated on the way in: a stored value that differs from
 * the computed one needs a mapping in both directions, and a mapping is a place
 * for the two to disagree.
 */
export const healthVerdictSchema = z.enum([
  "respected",
  "watch",
  "critical",
  "not-evaluable",
]);

export type HealthVerdict = z.infer<typeof healthVerdictSchema>;

/**
 * One finding, frozen as it was.
 *
 * Stored alongside the verdict rather than recomputed, for the same reason a
 * sprint report keeps its snapshot: a judgement reread next month has to keep
 * saying why it was reached. Recalculating would let the reason drift away from
 * the conclusion it explains.
 */
export const healthFindingSchema = z.object({
  /** Which of the five signals. */
  id: z.string().min(1).max(64),
  status: healthVerdictSchema,
  /** The catalogue entry the figure comes from. */
  metricId: z.string().min(1).max(64),
  measured: z.number().finite().nullable(),
  threshold: z.number().finite().nullable(),
  distance: z.number().finite().nonnegative().nullable(),
  /** What was missing. Present exactly when the status is `not-evaluable`. */
  missing: z.string().max(500).nullable(),
});

export type HealthFinding = z.infer<typeof healthFindingSchema>;

export const sprintHealthCheckSchema = z.object({
  id: sprintHealthCheckIdSchema,
  ...projectScopedFields,

  sprintId: sprintIdSchema,

  /**
   * The instant the judgement describes.
   *
   * The moment of the request, passed into the calculation — the engine still
   * never reads the clock (ADR-0002). It is also what makes a run idempotent
   * for a day: two executions on the same date describe the same day.
   */
  takenAt: timestampSchema,

  verdict: healthVerdictSchema,

  /** How much of the sprint had gone, between 0 and 1. */
  elapsedFraction: z.number().min(0).max(1),

  findings: z.array(healthFindingSchema).readonly(),

  ...auditFields,
});

export type SprintHealthCheck = z.infer<typeof sprintHealthCheckSchema>;

/**
 * Whether a run of checks found anything worth a second look.
 *
 * A verdict is "notable" when it is not serene and not an admission of
 * ignorance. Kept here rather than in a page because more than one caller will
 * eventually ask it, and two copies of a rule about severity is how the
 * interface and a future notification come to disagree about what an alarm is.
 */
export function isNotableVerdict(verdict: HealthVerdict): boolean {
  return verdict === "watch" || verdict === "critical";
}
