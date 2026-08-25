import {
  projectSchema,
  sprintSchema,
  stateTransitionSchema,
  workItemSchema,
  type OrganizationId,
  type Project,
  type Sprint,
  type WorkItem,
  type WorkItemState,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import {
  cycleTime,
  groupByWorkItem,
  type Milliseconds,
  type MetricResult,
} from "@/metrics";

/**
 * The list of work items, with just enough per row to be worth opening.
 *
 * Exists so that every figure on the dashboard has somewhere to lead. A median
 * cycle time of 2,8 giorni over 44 items is a claim; the list of those 44 items,
 * each with its own cycle time, is the evidence.
 *
 * Server-side only, tenant-scoped like everything under `src/app` (§8.4).
 */

export type WorkItemRow = {
  readonly item: WorkItem;
  readonly sprintName: string | null;
  readonly cycleTime: MetricResult<Milliseconds>;
  readonly transitionCount: number;
};

export type WorkItemList = {
  readonly project: Project;
  readonly rows: readonly WorkItemRow[];
  readonly sprints: readonly Sprint[];
  /** Echoed back so the page can show which filter is active. */
  readonly filter: WorkItemFilter;
  /** Items before filtering: the denominator of "n su m". */
  readonly totalCount: number;
  /**
   * Whether the agent may be asked a free question about this project.
   *
   * Read here so the form appears only when submitting it would work: a control
   * that always refuses teaches a reader to ignore controls.
   */
  readonly questionEnabled: boolean;
};

export type WorkItemFilter = {
  readonly state: WorkItemState | null;
  readonly sprintId: string | null;
  /** Only items that reached `done`, for checking a cycle-time figure. */
  readonly completedOnly: boolean;
};

export async function loadWorkItems(
  organizationId: OrganizationId,
  slug: string,
  filter: WorkItemFilter,
): Promise<WorkItemList | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [itemRows, transitionRows, sprintRows] = await Promise.all([
    scope.reads.workItemsByProject(project.id),
    scope.reads.transitionsByProject(project.id),
    scope.reads.sprintsByProject(project.id),
  ]);

  const items: WorkItem[] = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));
  const sprints = sprintRows.map((row) => sprintSchema.parse(row));

  const byItem = groupByWorkItem(transitions);
  const sprintNames = new Map(sprints.map((sprint) => [sprint.id, sprint.name]));

  const rows: WorkItemRow[] = items.map((item) => {
    const history = byItem.get(item.id) ?? [];

    return {
      item,
      sprintName: item.sprintId ? (sprintNames.get(item.sprintId) ?? null) : null,
      cycleTime: cycleTime(history),
      transitionCount: history.length,
    };
  });

  const filtered = rows.filter((row) => {
    if (filter.state && row.item.state !== filter.state) return false;
    if (filter.sprintId && row.item.sprintId !== filter.sprintId) return false;
    if (filter.completedOnly && !row.cycleTime.available) return false;
    return true;
  });

  /*
   * Longest first.
   *
   * The reason someone opens this list is almost always "what is taking so
   * long", and alphabetical order would bury the answer. Items without a cycle
   * time sort last: they are not fast, they are unfinished.
   */
  const sorted = [...filtered].sort((a, b) => {
    const left = a.cycleTime.available ? a.cycleTime.value : -1;
    const right = b.cycleTime.available ? b.cycleTime.value : -1;
    return right - left;
  });

  const agentRows = await scope.reads.scrumAgentByProject(project.id);

  return {
    project,
    rows: sorted,
    sprints,
    filter,
    totalCount: rows.length,
    questionEnabled: agentRows[0]?.enabledSkillKeys.includes("project-qa") ?? false,
  };
}
