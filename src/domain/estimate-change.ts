import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { estimateChangeIdSchema, personIdSchema, workItemIdSchema } from "./ids";
import { sourceFields } from "./source";
import { estimateSchema, type Estimate } from "./work-item";

/**
 * A change to a work item's estimate, with the instant it happened.
 *
 * **Why this entity exists.** Kniberg is categorical about how velocity is
 * counted: «Note that the actual velocity is based on the **initial** estimates
 * of each story. Any updates to the story time estimates done during the sprint
 * are ignored» (*Scrum and XP from the Trenches*, pag. 29).
 *
 * `WorkItem.estimate` holds one number, the current one. Reading it to compute
 * velocity means that correcting a story's estimate today changes the velocity
 * of a sprint that closed three weeks ago — a closed sprint's numbers moving
 * under the reader is the fastest way to lose the trust the whole product rests
 * on (ADR-0002).
 *
 * This is the same argument ADR-0003 already made about states, applied to
 * estimates: **a snapshot cannot reconstruct a history**. `StateTransition`
 * exists so we can ask "what state was it in *then*"; `EstimateChange` exists
 * so we can ask "what was it estimated at *then*".
 *
 * A source that does not expose estimate history is not a reason to drop the
 * entity. A connector that can only see the current value emits a single change
 * at the item's creation instant, and everything downstream keeps working — it
 * simply cannot distinguish a re-estimate that the source never recorded.
 */
export const estimateChangeSchema = z.object({
  id: estimateChangeIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  workItemId: workItemIdSchema,

  /**
   * `null` when the item had no estimate before this change.
   *
   * Distinct from an estimate of zero: "nobody had sized it yet" and "we sized
   * it and it is free" are different statements, and the book counts them
   * differently — an unestimated story contributes nothing to velocity, a
   * zero-point story contributes zero.
   */
  fromEstimate: estimateSchema.nullable(),

  /** `null` when the estimate was removed. */
  toEstimate: estimateSchema.nullable(),

  /** When the change happened in the origin system. Always UTC (§7). */
  occurredAt: timestampSchema,

  /**
   * Who changed it, when the source says so.
   *
   * For traceability only — never for counting how often someone re-estimates
   * (§8.2). Estimating is a team activity in the book: «every team member is
   * usually involved in estimating every story».
   */
  actorId: personIdSchema.nullable(),

  ...auditFields,
});

export type EstimateChange = z.infer<typeof estimateChangeSchema>;

/**
 * Orders changes oldest first, breaking ties by identifier.
 *
 * Same reasoning as `compareTransitions`: two changes can share a timestamp
 * after a bulk edit or from a source with second-level resolution, and a metric
 * that changes between two identical runs is worse than one that is merely
 * wrong.
 */
export function compareEstimateChanges(a: EstimateChange, b: EstimateChange): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups changes by work item, each group ordered.
 *
 * Mirrors `groupByWorkItem` in the metrics engine, but for estimates. It lives
 * here because ordering is a property of the entity, not of one calculation.
 */
export function groupEstimateChanges(
  changes: readonly EstimateChange[],
): ReadonlyMap<string, readonly EstimateChange[]> {
  const grouped = new Map<string, EstimateChange[]>();

  for (const change of changes) {
    const bucket = grouped.get(change.workItemId);
    if (bucket) bucket.push(change);
    else grouped.set(change.workItemId, [change]);
  }

  for (const bucket of grouped.values()) bucket.sort(compareEstimateChanges);

  return grouped;
}

/**
 * What the item was estimated at, at a given instant.
 *
 * `null` means "no estimate at that moment", which covers both an item never
 * sized and one sized only later. The caller must not turn that into zero: an
 * unestimated item is excluded from a sum, a zero-point one is included.
 *
 * The comparison is inclusive. A change recorded at exactly the instant an item
 * entered a sprint is part of the plan the team committed to, not a later
 * revision of it — the same boundary rule `isMidSprintAddition` applies to
 * membership, pointing the other way for the same reason.
 */
export function estimateAt(
  changes: readonly EstimateChange[],
  instant: Date,
): Estimate | null {
  let current: Estimate | null = null;

  for (const change of [...changes].sort(compareEstimateChanges)) {
    if (change.occurredAt.getTime() > instant.getTime()) break;
    current = change.toEstimate;
  }

  return current;
}
