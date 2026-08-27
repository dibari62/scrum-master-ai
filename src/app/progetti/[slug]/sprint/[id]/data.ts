import {
  ceremonyScheduleSchema,
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  UNSCHEDULED_CEREMONIES,
  workItemSchema,
  type CeremonySchedule,
  type OrganizationId,
  type Project,
  type Sprint,
  type WorkItem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import {
  demoAgenda,
  demoChecklist,
  membershipAt,
  totalEstimates,
  type DemoAgenda,
  type DemoChecklistEntry,
  type EstimateTotals,
} from "@/metrics";

/**
 * The sprint info page: what the whole company is told about a sprint.
 *
 * > «It is important to keep the whole company informed about what is going on.
 * > Otherwise, people will complain or, even worse, **make false assumptions**
 * > about what is going on. We use a sprint info page for this. Sometimes we
 * > include info about **how each story will be demonstrated** as well.»
 * > (pag. 52)
 *
 * In the book the Scrum Master writes it by hand after the planning meeting,
 * puts it on the wiki and prints it. Here it is **generated**, and that is the
 * one thing this version does better than the paper one: a page written once
 * describes the sprint as it was at the planning meeting, and a sprint that has
 * moved makes it quietly wrong. This one cannot go stale.
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

export type SprintInfo = {
  readonly project: Project;
  readonly sprint: Sprint;

  /** The items in the sprint at the reading instant, or at its close. */
  readonly items: readonly WorkItem[];
  readonly total: EstimateTotals;

  /** When the team meets, as the project declared it. */
  readonly ceremonies: CeremonySchedule;

  /**
   * How many items say how they will be demonstrated.
   *
   * The book calls this an optional part of the page — «*sometimes* we include
   * info about how each story will be demonstrated» — so its absence is not a
   * defect, and saying how much of it is filled in is more useful than either
   * hiding the gap or complaining about it.
   */
  readonly describedCount: number;

  /**
   * What to show at the demo, and what to name without showing (cap. 9).
   *
   * On the same page as the sprint contents on purpose: the book's rule about
   * demos — «mention them but don't demo them» — is a decision about the same
   * list of items, and splitting it onto its own page would mean deciding it
   * away from the stories it applies to.
   */
  readonly demo: DemoAgenda;
  readonly demoChecks: readonly DemoChecklistEntry[];
};

export async function loadSprintInfo(
  organizationId: OrganizationId,
  slug: string,
  sprintId: string,
  asOf: Date,
): Promise<SprintInfo | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [sprintRows, itemRows, scopeRows, contextRows, transitionRows] = await Promise.all([
    scope.reads.sprintsByProject(project.id),
    scope.reads.workItemsByProject(project.id),
    scope.reads.scopeEventsByProject(project.id),
    scope.reads.projectContextByProject(project.id),
    scope.reads.transitionsByProject(project.id),
  ]);

  const sprint = sprintRows.map((row) => sprintSchema.parse(row)).find((one) => one.id === sprintId);
  if (!sprint) return null;

  const all = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const scopeEvents = scopeRows.map((row) => sprintScopeEventSchema.parse(row));

  /*
   * La composizione **allora**, per uno sprint chiuso.
   *
   * Il legame fra elemento e sprint dice dove l'elemento sta oggi: usarlo
   * farebbe sparire da uno sprint concluso le storie trascinate in avanti, e
   * la pagina informativa racconterebbe uno sprint diverso da quello che la
   * squadra ha vissuto.
   */
  const instant = sprint.completedAt ?? asOf;
  const membership = membershipAt(scopeEvents, sprint, instant);
  const items = all.filter((item) => membership.has(item.id));

  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));
  const demoInput = { sprint, items: all, transitions, scopeEvents };

  return {
    project,
    sprint,
    items,
    total: totalEstimates(items),
    ceremonies: contextRows[0]
      ? ceremonyScheduleSchema.parse(contextRows[0].ceremonies)
      : // Nessun contesto dichiarato: nessuna cerimonia pianificata. Non è
        // «non ci sono riunioni», è «nessuno le ha ancora scritte qui».
        UNSCHEDULED_CEREMONIES,
    describedCount: items.filter((item) => item.howToDemo !== null).length,
    demo: demoAgenda(demoInput),
    demoChecks: demoChecklist(demoInput),
  };
}
