import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { sprintStatisticsIdSchema, sprintIdSchema } from "./ids";

/**
 * The sprint statistics document.
 *
 * The Scrum Master's checklist names it twice, once at each end of the sprint:
 *
 * > «Update the sprint statistics document. Add your **estimated velocity, team
 * > size, sprint length**, etc.» — beginning of sprint (pag. 163)
 *
 * > «Update the sprint statistics document. Add the **actual velocity** and key
 * > points from the retrospective.» — end of sprint (pag. 163)
 *
 * **Why the forecast is stored and the outcome is not.** This is the decision
 * worth arguing about, and it is not symmetry for its own sake.
 *
 * A forecast is *a statement somebody made at a moment*. Recomputing it later
 * would not be remembering it — it would be deciding it again, with data that
 * did not exist at the time. Yesterday's weather over the last three sprints
 * gives one answer in April and another in June, and the June answer is not
 * what the team planned against. So the forecast is written down, once, and
 * never derived.
 *
 * The actual velocity is the opposite: since `EstimateChange` fixed it to the
 * estimates items carried on entry, it is **stable** — the same inputs give the
 * same number next year. Storing it too would create a second source of truth
 * that can silently drift from the first, and the day they disagree there is no
 * way to tell which one is wrong. So it is derived at read time, from the same
 * engine that draws the chart beside it.
 *
 * The rule, stated once: **store what cannot be recovered, derive what can.**
 *
 * There is no `actualVelocity` field here and adding one would be a regression,
 * however convenient it looks.
 */

/**
 * How the forecast was reached.
 *
 * Mirrors `ForecastMethod` in the metrics engine, and is stored **with** the
 * number rather than assumed. A figure produced by yesterday's weather and one
 * produced by capacity times focus factor are different claims about the world,
 * and a document that records only the number loses which claim was made.
 */
export const forecastMethodSchema = z.enum([
  "yesterdays-weather",
  "focus-factor",
  "default-focus-factor",
]);

export type StoredForecastMethod = z.infer<typeof forecastMethodSchema>;

/** A ceiling that catches a typo rather than expressing a preference. */
export const MAX_FORECAST_POINTS = 10_000;

export const sprintStatisticsSchema = z.object({
  id: sprintStatisticsIdSchema,
  ...projectScopedFields,

  sprintId: sprintIdSchema,

  /**
   * The instant the forecast was recorded.
   *
   * Kept because a forecast written on the first morning and one written on
   * day eight are not equally impressive, and a document that hides when it was
   * filled in invites the second to be read as the first.
   */
  recordedAt: timestampSchema,

  /** Points the team expected to finish. Always points: see `focusFactor`. */
  forecastPoints: z.number().min(0).max(MAX_FORECAST_POINTS),

  method: forecastMethodSchema,

  /**
   * The focus factor behind the number, when the method used one.
   *
   * `null` for yesterday's weather, which never computes one. Deriving a factor
   * there and storing it would invent a precision the method does not claim.
   */
  focusFactor: z.number().min(0).nullable(),

  /**
   * How many people the sprint was planned for.
   *
   * A **count**, never a list. The book records team size because it explains a
   * change in velocity; who was on the team is a different question, and one
   * that leads directly towards per-person figures (§8.2).
   */
  teamSize: z.number().int().min(0),

  /** Working days the sprint holds — not calendar days. */
  workingDays: z.number().int().min(0),

  ...auditFields,
});

export type SprintStatistics = z.infer<typeof sprintStatisticsSchema>;
