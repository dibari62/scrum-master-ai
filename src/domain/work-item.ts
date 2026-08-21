import { z } from "zod";

import {
  auditFields,
  descriptionSchema,
  displayNameSchema,
  projectScopedFields,
  timestampSchema,
} from "./common";
import { personIdSchema, sprintIdSchema, workItemIdSchema } from "./ids";
import { sourceFields } from "./source";

/**
 * `WorkItem` is the single term for story, bug, task, epic and spike: the kind
 * is a field, not a separate entity (glossary §2). Every tool names these
 * differently, and one shape with a discriminating field is what keeps metrics
 * and skills from growing a branch per source.
 */

export const workItemKindSchema = z.enum(["story", "bug", "task", "epic", "spike"]);

export type WorkItemKind = z.infer<typeof workItemKindSchema>;

/**
 * The canonical states. Native statuses are mapped onto these by a declarative,
 * per-project configuration — never by code buried in a connector (ADR-0003).
 */
export const workItemStateSchema = z.enum([
  "todo",
  "in_progress",
  "in_review",
  "blocked",
  "done",
  "cancelled",
]);

export type WorkItemState = z.infer<typeof workItemStateSchema>;

/**
 * States that count as work in progress.
 *
 * Declared once here because three metrics depend on the same answer — `wip`,
 * `flowEfficiency` and `blockedTime` — and three copies of the list would
 * eventually disagree. `blocked` is deliberately excluded: an item nobody can
 * move is not being worked on, and counting it as active would make a stuck
 * team look busy.
 */
const ACTIVE_STATES: ReadonlySet<WorkItemState> = new Set(["in_progress", "in_review"]);

export function isActiveState(state: WorkItemState): boolean {
  return ACTIVE_STATES.has(state);
}

/**
 * States from which an item is no longer expected to move.
 *
 * `cancelled` is terminal but is **not** completion: counting it as done would
 * inflate velocity by rewarding abandoned work.
 */
const TERMINAL_STATES: ReadonlySet<WorkItemState> = new Set(["done", "cancelled"]);

export function isTerminalState(state: WorkItemState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isCompletedState(state: WorkItemState): boolean {
  return state === "done";
}

/**
 * An estimate, always with its unit.
 *
 * The glossary is explicit: never assume story points. A team estimating in
 * hours and one estimating in points produce numbers that must not be summed
 * together, and a bare number makes that mistake invisible.
 */
export const estimateSchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: z.enum(["points", "hours"]),
});

export type Estimate = z.infer<typeof estimateSchema>;

export const workItemSchema = z.object({
  id: workItemIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  kind: workItemKindSchema,
  title: displayNameSchema.max(500),
  description: descriptionSchema,

  /**
   * Current state **as reported by the source**.
   *
   * Convenient for listing a board, but metrics must not read it: they derive
   * from `StateTransition`, which is the only record of how and when the item
   * got here (ADR-0003). A source that reports a state without the matching
   * transition is a connector defect, and the conformance suite says so.
   */
  state: workItemStateSchema,

  estimate: estimateSchema.nullable(),

  /** `null` for an item still in the backlog. */
  sprintId: sprintIdSchema.nullable(),

  /**
   * Who is currently working on it.
   *
   * Present because a digest has to be able to say which items are stuck and
   * who could unblock them. It must **never** be aggregated into a measure of
   * individual output: §8.2 forbids per-person performance metrics, and this
   * field is the shortest path to violating that rule by accident.
   */
  assigneeId: personIdSchema.nullable(),

  /** When the item appeared in the origin system, not when we ingested it. */
  sourceCreatedAt: timestampSchema,

  /**
   * Parent item, for a story under an epic.
   *
   * A plain identifier rather than a nested structure: hierarchies arrive
   * partially, and a schema demanding a whole tree cannot represent a child
   * whose parent has not been ingested yet.
   */
  parentId: workItemIdSchema.nullable(),

  ...auditFields,
});

export type WorkItem = z.infer<typeof workItemSchema>;
