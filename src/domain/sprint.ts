import { z } from "zod";

import {
  auditFields,
  descriptionSchema,
  displayNameSchema,
  projectScopedFields,
  timestampSchema,
} from "./common";
import { sprintIdSchema, workItemIdSchema } from "./ids";
import { sourceFields } from "./source";

/**
 * A fixed-length iteration with a start, an end and a goal.
 */
export const sprintSchema = z.object({
  id: sprintIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  name: displayNameSchema,

  /**
   * The single purpose of the sprint: prose, not a list of tasks (glossary §2).
   * `null` when the team did not record one — which is itself worth reporting.
   */
  goal: descriptionSchema,

  startsAt: timestampSchema,
  endsAt: timestampSchema,

  /**
   * When the sprint was actually closed.
   *
   * Distinct from `endsAt` on purpose: a sprint closed two days late is a real
   * signal, and collapsing the planned end into the actual one would erase it.
   */
  completedAt: timestampSchema.nullable(),

  ...auditFields,
});

export type Sprint = z.infer<typeof sprintSchema>;

/**
 * Rejects a sprint whose end precedes its start.
 *
 * Expressed as a refinement rather than baked into `sprintSchema` so the base
 * shape stays composable with `.pick()` and `.partial()`, which a refined
 * object loses.
 */
export const validSprintSchema = sprintSchema.refine(
  (sprint) => sprint.endsAt.getTime() > sprint.startsAt.getTime(),
  { message: "La fine dello sprint deve seguire l'inizio.", path: ["endsAt"] },
);

export function isWithinSprint(sprint: Sprint, instant: Date): boolean {
  const time = instant.getTime();
  return time >= sprint.startsAt.getTime() && time <= sprint.endsAt.getTime();
}

/**
 * A change in which items belong to a sprint.
 *
 * **Addition to the glossary, in attesa di approvazione** — see
 * `docs/domain-glossary.md`. It exists because two required metrics cannot be
 * computed without it:
 *
 * - `scopeChange` is «work added or removed **after** the sprint started», so
 *   it needs the moment membership changed, not merely the current membership;
 * - `carryOver` is «unfinished items that pass to the next sprint», which needs
 *   to know the item was in the previous one.
 *
 * A `sprintId` on `WorkItem` answers "where is it now" and loses both. It is
 * the same reasoning ADR-0003 applies to `StateTransition`: a snapshot cannot
 * reconstruct a history.
 */
export const sprintScopeEventKindSchema = z.enum(["added", "removed"]);

export type SprintScopeEventKind = z.infer<typeof sprintScopeEventKindSchema>;

/**
 * Why work entered a sprint after it had started.
 *
 * > «We've had three **unplanned items**, as you can see down to the right.
 * > This is useful to remember when you do the sprint retrospective.» (pag. 60)
 *
 * The book keeps unplanned items in an area of their own on the task board,
 * and the retrospective has a line for them — «Too many external disturbances»
 * (pag. 89). The two things it separates are genuinely different: a Product
 * Owner deliberately pulling in more work because the team had room is a plan
 * being extended, while an interruption is the plan being broken into.
 *
 * **It belongs to the event, not to the item.** The same story can be a planned
 * addition in one sprint and an interruption in another — what is unplanned is
 * the *arrival*, not the work.
 */
export const scopeChangeReasonSchema = z.enum(["planned", "unplanned"]);

export type ScopeChangeReason = z.infer<typeof scopeChangeReasonSchema>;

export const sprintScopeEventSchema = z.object({
  ...projectScopedFields,
  ...sourceFields,

  sprintId: sprintIdSchema,
  workItemId: workItemIdSchema,
  kind: sprintScopeEventKindSchema,

  /**
   * `null` means **the source does not say**, and it is not a synonym for
   * "planned".
   *
   * Most tools have no field for it: Jira knows an issue moved into a sprint,
   * not whether somebody's afternoon was hijacked. Defaulting the unknown to
   * `planned` would under-report interruptions and defaulting it to
   * `unplanned` would over-report them — so the third state is kept, and the
   * metrics report it instead of choosing.
   */
  reason: scopeChangeReasonSchema.nullable(),

  occurredAt: timestampSchema,

  ...auditFields,
});

export type SprintScopeEvent = z.infer<typeof sprintScopeEventSchema>;

/**
 * True when the event represents work that entered the sprint after it began.
 *
 * The comparison is strict: items added exactly at the start instant are the
 * planned commitment, not a scope change.
 */
export function isMidSprintAddition(event: SprintScopeEvent, sprint: Sprint): boolean {
  return (
    event.kind === "added" && event.occurredAt.getTime() > sprint.startsAt.getTime()
  );
}
