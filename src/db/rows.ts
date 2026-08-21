/**
 * Conversion between the canonical model and database rows.
 *
 * Only entities whose row shape differs from the canonical shape belong here.
 * Everything else maps field for field and needs no translation.
 *
 * The two directions live side by side deliberately. They were previously
 * written in two different places — the write path in `scripts/seed.ts`, the
 * read path in `src/app/progetti/data.ts` — and they silently disagreed: the
 * writer dropped `estimate` entirely, so every estimate in the database was
 * null while the reader dutifully reconstructed nothing. Nothing failed, no
 * test broke, and the dashboard reported "nessuna stima" for four sprints.
 *
 * TypeScript cannot catch that on its own. `db.insert(t).values(rows)` accepts
 * a variable holding objects with extra properties (excess property checks only
 * apply to object literals), and every column `estimate` should have filled is
 * nullable, therefore optional. Only an explicit mapper written as an object
 * literal makes the compiler check the correspondence.
 */

import type { WorkItem } from "@/domain";
import { estimateSchema } from "@/domain";

import type { workItems } from "./schema";

/**
 * Every column, none optional.
 *
 * `$inferInsert` makes nullable columns optional, so a mapper that simply
 * forgot one would still typecheck and write a null. Requiring all of them
 * turns "fill every column" from a convention into a compile error.
 */
type WorkItemRow = Required<typeof workItems.$inferInsert>;

/** The subset of a selected row this module needs to rebuild an estimate. */
export interface WorkItemEstimateColumns {
  readonly estimateValue: number | null;
  readonly estimateUnit: string | null;
}

/**
 * Canonical item to insertable row.
 *
 * Written as an object literal so that a renamed or forgotten column is a
 * compile error rather than a null in production.
 */
export function toWorkItemRow(item: WorkItem): WorkItemRow {
  return {
    id: item.id,
    organizationId: item.organizationId,
    projectId: item.projectId,
    sourceSystem: item.sourceSystem,
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title,
    description: item.description,
    state: item.state,
    estimateValue: item.estimate?.value ?? null,
    estimateUnit: item.estimate?.unit ?? null,
    sprintId: item.sprintId,
    assigneeId: item.assigneeId,
    parentId: item.parentId,
    sourceCreatedAt: item.sourceCreatedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/**
 * Rebuilds the canonical `estimate` from its two columns.
 *
 * Half an estimate is not an estimate: a value without a unit cannot be summed
 * with anything, so it is treated as absent rather than guessed at. The unit is
 * parsed, not cast — the column is plain `text`, and a value that is neither
 * `points` nor `hours` means the database disagrees with the domain, which is a
 * defect worth surfacing rather than swallowing.
 */
export function workItemEstimate(row: WorkItemEstimateColumns): WorkItem["estimate"] {
  if (row.estimateValue === null || row.estimateUnit === null) return null;

  return estimateSchema.parse({ value: row.estimateValue, unit: row.estimateUnit });
}
