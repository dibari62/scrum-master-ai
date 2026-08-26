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
 * States counted as work in progress.
 *
 * This is a measure of **load**: how much the team has taken on and not yet
 * finished. An item waiting for review still occupies a slot, so it counts.
 *
 * `blocked` is excluded: an item nobody can move is not being worked on, and
 * counting it as in progress would make a stuck team look busy.
 *
 * Deliberately *not* the same list as `isValueAdding`. See the note there.
 */
const WIP_STATES: ReadonlySet<WorkItemState> = new Set(["in_progress", "in_review"]);

export function countsTowardWip(state: WorkItemState): boolean {
  return WIP_STATES.has(state);
}

/**
 * States in which someone is actually working on the item.
 *
 * This is a measure of **work**, and it is what flow efficiency divides by
 * elapsed time. `in_review` is excluded: an item sitting in a review queue is
 * waiting, not being worked on, and almost no source distinguishes "waiting to
 * be reviewed" from "being reviewed right now".
 *
 * **Why two lists rather than one word.** They answer different questions —
 * load and waste — and calling both "active" was what produced open question Q1
 * in the glossary: flow efficiency read a flat 100% on data where review wait
 * climbed from hours to days, because time in the review queue was being
 * counted as work. A metric that cannot fall is not a metric.
 *
 * The approximation is knowing: the minutes a reviewer spends reading are
 * counted as waste too. It errs towards showing a bottleneck that may not be
 * there rather than hiding one that is — the right direction for a diagnostic.
 */
const VALUE_ADDING_STATES: ReadonlySet<WorkItemState> = new Set(["in_progress"]);

export function isValueAdding(state: WorkItemState): boolean {
  return VALUE_ADDING_STATES.has(state);
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

  /**
   * Position in the product backlog: **an order, not a score**.
   *
   * The book used a numeric `Importance` column and the author retracts it in
   * the second edition — «there's no importance column. Instead, I just order
   * the list». The retraction matters because the two are not the same thing: a
   * score invites arithmetic ("this is twice as important"), and two items
   * scored 100 leave the question of which comes first unanswered. An order
   * answers exactly one question, which is the only one planning needs.
   *
   * `null` means "not placed", which is different from "last": a source that
   * exposes no ranking gives us nothing to place items by, and inventing a
   * position would look like a decision the Product Owner never made.
   *
   * **Not unique**, deliberately. Enforcing uniqueness would make swapping two
   * adjacent items impossible without a temporary value, and the guarantee is
   * not worth that: `compareBacklogOrder` breaks ties deterministically, so a
   * duplicate degrades the list instead of corrupting it.
   */
  backlogOrder: z.number().int().nonnegative().nullable(),

  /**
   * How this item will be shown at the sprint demo.
   *
   * > «How to demo — a high-level description of how this story will be
   * > demonstrated at the sprint demo. This is **essentially a simple test
   * > spec**. Do this, then do that, then this should happen.» (pag. 7)
   *
   * One of the six fields the book says it used sprint after sprint, and the
   * one that does the most work: it is the closest thing to an acceptance
   * criterion that fits on a card.
   *
   * **Untrusted content** (§8.1), like every ingested text: it is data, and it
   * is delimited if it ever reaches a model.
   */
  howToDemo: descriptionSchema,

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

/**
 * Orders two items the way the Product Owner placed them.
 *
 * Three rules, in order, and each exists for a reason:
 *
 * 1. **A placed item comes before an unplaced one.** `null` is "not ranked
 *    yet", and an unranked item at the top of a release plan would be a
 *    commitment nobody made.
 * 2. **Lower `backlogOrder` first** — it is a position, so 1 precedes 2.
 * 3. **Ties break on arrival, then on identifier.** Duplicates are possible by
 *    design (see the field), and a comparator that left them unordered would
 *    make the same backlog produce two different release plans on two runs.
 *    A plan that changes when nothing changed cannot be trusted.
 */
export function compareBacklogOrder(a: WorkItem, b: WorkItem): number {
  if (a.backlogOrder !== b.backlogOrder) {
    if (a.backlogOrder === null) return 1;
    if (b.backlogOrder === null) return -1;
    return a.backlogOrder - b.backlogOrder;
  }

  const arrival = a.sourceCreatedAt.getTime() - b.sourceCreatedAt.getTime();
  if (arrival !== 0) return arrival;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The product backlog: what is **not yet in a sprint and not yet done**, in the
 * order the Product Owner put it.
 *
 * The glossary has said "insieme **ordinato** di work item non ancora in uno
 * sprint" since the first day, and until now nothing stored the order — the
 * word was true as an intention and false as a fact. This is the function that
 * makes it true.
 *
 * `done` items are excluded even when they never belonged to a sprint: the
 * backlog is what remains to be planned, and something already delivered would
 * inflate every release forecast built on it.
 *
 * Returns a new array; the input is not modified.
 */
export function productBacklog(items: readonly WorkItem[]): readonly WorkItem[] {
  return items
    .filter((item) => item.sprintId === null && item.state !== "done")
    .sort(compareBacklogOrder);
}
