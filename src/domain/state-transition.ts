import { z } from "zod";

import { auditFields, projectScopedFields, timestampSchema } from "./common";
import { personIdSchema, stateTransitionIdSchema, workItemIdSchema } from "./ids";
import { sourceFields } from "./source";
import { workItemStateSchema, type WorkItemState } from "./work-item";

/**
 * A single move of a work item from one state to another.
 *
 * ADR-0003 makes this a first-class entity rather than a detail, because almost
 * every flow metric derives from the history of moves and not from the current
 * state. Cycle time, blocked time, reopen rate and flow efficiency are all
 * unanswerable from a snapshot.
 *
 * A source that only exposes the current status must be integrated by reading
 * its change log or by sampling — that is a connector's problem to solve, not
 * something the model may leave out.
 */
export const stateTransitionSchema = z.object({
  id: stateTransitionIdSchema,
  ...projectScopedFields,
  ...sourceFields,

  workItemId: workItemIdSchema,

  /**
   * `null` only for the very first transition, when the item came into
   * existence. Modelling creation as a transition from nothing keeps the
   * history complete: otherwise the time before the first recorded move
   * silently disappears from lead time.
   */
  fromState: workItemStateSchema.nullable(),
  toState: workItemStateSchema,

  /** When the move happened in the origin system. Always UTC (§7). */
  occurredAt: timestampSchema,

  /**
   * Who moved it, when the source says so.
   *
   * For traceability and for asking a person about a specific change — never
   * for counting how many moves someone performed (§8.2).
   */
  actorId: personIdSchema.nullable(),

  ...auditFields,
});

export type StateTransition = z.infer<typeof stateTransitionSchema>;

/**
 * Orders transitions oldest first, breaking ties by identifier.
 *
 * Two moves can share a timestamp: a bulk edit, or a source with second-level
 * resolution. Without a tie-breaker the order would depend on however the rows
 * came back from the database, and a metric that changes between two identical
 * runs is worse than one that is merely wrong.
 */
export function compareTransitions(a: StateTransition, b: StateTransition): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Checks that a history is internally consistent.
 *
 * Returns the reasons it is not, empty when it holds. Used by the connector
 * conformance suite: a connector that emits an incoherent history produces
 * metrics that are wrong in ways nobody notices, because every individual
 * number still looks plausible.
 */
export function findHistoryDefects(
  transitions: readonly StateTransition[],
): readonly string[] {
  if (transitions.length === 0) return [];

  const ordered = [...transitions].sort(compareTransitions);
  const defects: string[] = [];

  const first = ordered[0];
  if (first && first.fromState !== null) {
    defects.push("la prima transizione deve partire da uno stato assente");
  }

  let previous: WorkItemState | null = null;
  for (const [index, transition] of ordered.entries()) {
    if (index > 0 && transition.fromState === null) {
      defects.push("solo la prima transizione può partire da uno stato assente");
    }

    if (index > 0 && transition.fromState !== previous) {
      defects.push(
        `transizione ${index}: parte da ${String(transition.fromState)} ma lo stato precedente era ${String(previous)}`,
      );
    }

    if (transition.fromState === transition.toState) {
      defects.push(`transizione ${index}: stato invariato (${transition.toState})`);
    }

    previous = transition.toState;
  }

  return defects;
}
