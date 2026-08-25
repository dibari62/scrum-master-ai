import { z } from "zod";

import { auditFields, projectScopedFields } from "./common";
import { personIdSchema, sprintIdSchema } from "./ids";

/**
 * How much of a sprint a person is available for.
 *
 * **Why this exists.** The book's capacity calculation needs it: «Let's say we
 * are planning a three-week sprint (15 work days) with a four-person team. Lisa
 * will be on vacation for two days. Dave is only 50% available and will be on
 * vacation for one day. Putting all this together … gives us 50 available
 * man-days» (*Scrum and XP from the Trenches*, pag. 30). Without allocation and
 * absences, that fifty is uncomputable.
 *
 * **This is a calendar fact, never a performance one, and the distinction is
 * the whole reason to be careful here.** §8.2 forbids per-person productivity
 * metrics outright, and this record is the shortest path to breaking that rule
 * by accident: put availability next to "points closed by this person" and the
 * forbidden number computes itself.
 *
 * So the rule is structural, not a warning in a comment:
 *
 * - capacity is only ever exposed as a **team total** (`availableManDays`);
 * - nothing in `src/metrics` accepts a person and returns work done;
 * - a person's absences say when they were *away*, never how they performed.
 *
 * Recording that someone is on holiday is legitimate and useful. Dividing
 * anything by it is not.
 */

/**
 * Share of a working day this person gives to this project, from 0 to 1.
 *
 * A fraction rather than a percentage: percentages invite `50` where `0.5` is
 * meant, and the two differ by a factor of a hundred in a number nobody checks.
 *
 * Zero is allowed and is not the same as absent for every day: it says "on the
 * team, allocated nowhere" — which happens, and which a plan should show rather
 * than hide by omitting the person.
 */
export const allocationShareSchema = z.number().min(0).max(1);

export type AllocationShare = z.infer<typeof allocationShareSchema>;

/** Nobody is away for more days than a long sprint has; the bound catches a typo. */
export const MAX_ABSENCE_DAYS = 60;

export const teamMemberAvailabilitySchema = z.object({
  ...projectScopedFields,

  sprintId: sprintIdSchema,
  personId: personIdSchema,

  allocationShare: allocationShareSchema,

  /**
   * Working days this person is away during the sprint.
   *
   * A count, not a list of dates. The book only ever uses the count — «Lisa
   * will be on vacation for two days» — and holding the dates would let someone
   * ask *when* a named person was absent, which is a question about a person
   * rather than about capacity.
   *
   * Counted in **working** days: a holiday falling on a Sunday is not a day
   * off, and subtracting it would remove capacity that never existed.
   */
  absentWorkingDays: z.number().int().min(0).max(MAX_ABSENCE_DAYS),

  ...auditFields,
});

export type TeamMemberAvailability = z.infer<typeof teamMemberAvailabilitySchema>;

/**
 * The default for a person nobody has declared anything about.
 *
 * Full allocation, no absences — the assumption a plan makes when it has no
 * information. It is stated here rather than defaulted at each call site so
 * that "we assumed everyone was fully available" is one decision that can be
 * found, argued with and changed.
 */
export const FULL_AVAILABILITY = {
  allocationShare: 1,
  absentWorkingDays: 0,
} as const;
