import {
  impedimentSchema,
  projectSchema,
  retrospectiveSchema,
  sprintSchema,
  sprintScopeEventSchema,
  sprintStatisticsSchema,
  stateTransitionSchema,
  workItemSchema,
  type OrganizationId,
  type Project,
  type Sprint,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { toEstimateChange, workItemEstimate } from "@/db/rows";
import {
  burndown,
  membershipAt,
  planningGuidelines,
  scrumMasterChecklist,
  sprintItemCount,
  type Burndown,
  type ChecklistEntry,
  type MetricResult,
  type PlanningGuidelines,
} from "@/metrics";

/**
 * The sprints of a project, each with the one figure that describes it.
 *
 * Sprints existed in the database from the first day and were visible only as
 * bars on the dashboard, which answer "how did they compare" and never "what
 * were they". This is the register: name, goal, dates, and how many items each
 * one held.
 *
 * The count comes from `src/metrics` and is not computed here (R1). That is not
 * ceremony: the number has a definition — the composition of the sprint at the
 * instant it closed, rebuilt from the scope events — and definitions belong
 * where they are tested, not in the file that draws the list.
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

/**
 * Where a sprint is in its own life.
 *
 * Four states rather than the "concluso sì/no" the eye expects, because
 * `completedAt` and `endsAt` are deliberately different fields: a sprint whose
 * end date has passed but that nobody closed is a real and common situation,
 * and calling it "concluso" would state something the data does not say.
 */
export type SprintStatus = "planned" | "running" | "ended" | "closed";

export type SprintRow = {
  readonly sprint: Sprint;
  readonly status: SprintStatus;
  /** Items in the sprint at its closing instant, or as it stands now. */
  readonly itemCount: MetricResult<number>;

  /**
   * How the work burned down, day by day.
   *
   * **Why it is here and not only on the dashboard.** The dashboard draws one
   * burndown, for the most recent sprint — which is right for a dashboard,
   * because that is the only chart you can still act on. The consequence was
   * that a *closed* sprint had no burndown anywhere: "come è andato lo sprint
   * 2, giorno per giorno" was unanswerable, even though `burndown()` accepts
   * any sprint and always could.
   *
   * This is the register of sprints, so it is where that question belongs.
   */
  readonly burndown: MetricResult<Burndown>;

  /**
   * The book's numeric guidelines for this sprint's contents.
   *
   * Per sprint and not per project, because "5 to 15 stories" is a statement
   * about one iteration: totalling four sprints would produce a number the
   * guideline was never about.
   */
  readonly guidelines: PlanningGuidelines;

  /**
   * The Scrum Master's checklist for this sprint (cap. 16).
   *
   * Per sprint, because the entries are about *this* iteration: «create a
   * sprint info page», «hold the retrospective». A project-wide checklist
   * would have nothing to be checked against.
   */
  readonly checklist: readonly ChecklistEntry[];
};

export type ProjectSprints = {
  readonly project: Project;
  readonly rows: readonly SprintRow[];
  readonly asOf: Date;
};

function statusOf(sprint: Sprint, asOf: Date): SprintStatus {
  if (sprint.completedAt !== null) return "closed";
  if (asOf.getTime() < sprint.startsAt.getTime()) return "planned";
  if (asOf.getTime() <= sprint.endsAt.getTime()) return "running";
  return "ended";
}

export async function loadProjectSprints(
  organizationId: OrganizationId,
  slug: string,
  asOf: Date,
): Promise<ProjectSprints | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  /*
   * Sprint e variazioni di perimetro, non gli elementi.
   *
   * Il conteggio si ricava dalla storia della composizione, che è l'unica
   * fonte capace di dire cosa conteneva uno sprint *allora*: il legame fra
   * elemento e sprint dice dove l'elemento si trova adesso, e un elemento
   * trascinato in avanti farebbe rimpicciolire uno sprint già chiuso.
   */
  const [sprintRows, scopeRows, itemRows, transitionRows, estimateRows, impedimentRows, retroRows, statsRows] =
    await Promise.all([
      scope.reads.sprintsByProject(project.id),
      scope.reads.scopeEventsByProject(project.id),
      scope.reads.workItemsByProject(project.id),
      scope.reads.transitionsByProject(project.id),
      scope.reads.estimateChangesByProject(project.id),
      scope.reads.impedimentsByProject(project.id),
      scope.reads.retrospectivesByProject(project.id),
      scope.reads.sprintStatisticsByProject(project.id),
    ]);

  const sprints = sprintRows.map((row) => sprintSchema.parse(row));
  const scopeEvents = scopeRows.map((row) => sprintScopeEventSchema.parse(row));
  const items = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));
  const estimateChanges = estimateRows.map((row) => toEstimateChange(row));
  const impediments = impedimentRows.map((row) => impedimentSchema.parse(row));
  const retrospectives = retroRows.map((row) => retrospectiveSchema.parse(row));
  const statistics = statsRows.map((row) => sprintStatisticsSchema.parse(row));

  const rows = sprints.map((sprint): SprintRow => {
    /*
     * La composizione allora, non quella di adesso.
     *
     * Per uno sprint chiuso si guarda l'istante di chiusura: il legame fra
     * elemento e sprint dice dove l'elemento sta *oggi*, e un elemento
     * trascinato in avanti farebbe sparire una storia da uno sprint concluso
     * settimane fa.
     */
    const instant = sprint.completedAt ?? asOf;
    const membership = membershipAt(scopeEvents, sprint, instant);
    const sprintItems = items.filter((item) => membership.has(item.id));

    return {
      sprint,
      status: statusOf(sprint, asOf),
      itemCount: sprintItemCount(sprint, scopeEvents, asOf),
      burndown: burndown(sprint, items, transitions, scopeEvents, asOf, {
        estimateChanges,
      }),
      guidelines: planningGuidelines(sprintItems),
      checklist: scrumMasterChecklist({
        sprint,
        transitions,
        scopeEvents,
        impediments,
        retrospectives,
        statistics,
        asOf,
      }),
    };
  });

  /*
   * Il più recente per primo.
   *
   * La lettura condivisa ordina per data di inizio crescente, che è l'ordine
   * giusto per un grafico che racconta un'evoluzione. Qui la domanda è
   * un'altra — «com'è andato l'ultimo sprint» — e metterlo in fondo
   * significherebbe far scorrere la pagina per arrivare alla riga che
   * interessa quasi sempre.
   */
  return { project, rows: [...rows].reverse(), asOf };
}
