import {
  personSchema,
  projectSchema,
  sprintSchema,
  stateTransitionSchema,
  workItemSchema,
  type OrganizationId,
  type Person,
  type Project,
  type Sprint,
  type StateTransition,
  type WorkItem,
  type WorkItemId,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import {
  agingWorkItem,
  blockedTime,
  cycleTime,
  flowEfficiency,
  leadTime,
  reopenCount,
  reviewWaitTime,
  stateIntervals,
  type Milliseconds,
  type MetricResult,
  type StateInterval,
} from "@/metrics";

/**
 * One work item, its history, and the metrics computed from it.
 *
 * **Why this page exists.** The dashboard reports a median cycle time of 2,8
 * giorni and the reader has to take it on faith: there is no way to see *which*
 * items, or how the figure arises from what happened. A number nobody can open
 * is a number that must be believed, and this project is built on the claim
 * that its numbers are checkable.
 *
 * So this module returns the metrics **and** the spans they were computed from,
 * side by side. That is not decoration: it is what lets someone follow the
 * arithmetic instead of trusting it.
 *
 * Server-side only, like `data.ts` beside it, and every read goes through the
 * tenant scope (§8.4).
 */

export type WorkItemDetail = {
  readonly project: Project;
  readonly item: WorkItem;
  readonly sprint: Sprint | null;
  readonly assignee: Person | null;
  readonly transitions: readonly StateTransition[];
  /** The spans the metrics are computed from, in order. */
  readonly intervals: readonly StateInterval[];
  readonly cycleTime: MetricResult<Milliseconds>;
  readonly leadTime: MetricResult<Milliseconds>;
  readonly flowEfficiency: MetricResult<number>;
  readonly reviewWait: MetricResult<Milliseconds>;
  readonly blocked: Milliseconds;
  readonly aging: MetricResult<Milliseconds>;
  readonly reopenings: number;
  readonly asOf: Date;
};

/**
 * Loads one item with everything needed to explain its numbers.
 *
 * Returns `null` when the item does not exist **or** belongs to another
 * organization: the two cases are deliberately indistinguishable from outside,
 * so a wrong identifier cannot confirm that something exists elsewhere.
 */
export async function loadWorkItemDetail(
  organizationId: OrganizationId,
  slug: string,
  workItemId: WorkItemId,
  asOf: Date,
): Promise<WorkItemDetail | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [itemRow] = await scope.reads.workItemById(workItemId);
  if (!itemRow) return null;

  // Scoped to the organization, but not yet to *this project*: without the
  // check an item of another project would render under this project's heading
  // and its breadcrumb would lie.
  if (itemRow.projectId !== project.id) return null;

  const item = workItemSchema.parse({ ...itemRow, estimate: workItemEstimate(itemRow) });

  const [transitionRows, sprintRows, peopleRows] = await Promise.all([
    scope.reads.transitionsByWorkItem(workItemId),
    item.sprintId ? scope.reads.sprintById(item.sprintId) : Promise.resolve([]),
    scope.reads.peopleByProject(project.id),
  ]);

  const transitions: readonly StateTransition[] = transitionRows.map((row) =>
    stateTransitionSchema.parse(row),
  );

  const sprintRow = sprintRows[0];
  const people = peopleRows.map((row) => personSchema.parse(row));

  return {
    project,
    item,
    sprint: sprintRow ? sprintSchema.parse(sprintRow) : null,
    assignee: people.find((person) => person.id === item.assigneeId) ?? null,
    transitions,
    intervals: stateIntervals(transitions, asOf),
    cycleTime: cycleTime(transitions),
    leadTime: leadTime(item, transitions),
    flowEfficiency: flowEfficiency(transitions, asOf),
    reviewWait: reviewWaitTime(transitions, asOf),
    blocked: blockedTime(transitions, asOf),
    aging: agingWorkItem(transitions, asOf),
    reopenings: reopenCount(transitions),
    asOf,
  };
}
