import {
  boardColumnSchema,
  personSchema,
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type OrganizationId,
  type Project,
  type Sprint,
  type SprintScopeEvent,
  type StateTransition,
  type WorkItem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import {
  burndown,
  carryOver,
  scopeChange,
  sprintHealth,
  summariseFlow,
  velocity,
  workInProgress,
  type BurndownPoint,
  type CarryOver,
  type EstimateTotals,
  type FlowSummary,
  type MetricResult,
  type ScopeChange,
  type SprintHealth,
} from "@/metrics";

/**
 * Loading a project's data and computing its metrics.
 *
 * Lives beside the page rather than in `src/lib` because it is that page's
 * concern, and lives outside the component so the component stays
 * presentational (§4).
 *
 * Every read goes through the tenant scope, so the organization filter is
 * applied by the shared helper rather than by this file remembering to (§8.4).
 *
 * **Server-side only.** It opens a database connection, so importing it from a
 * component marked `"use client"` would be a serious mistake. The `server-only`
 * package turns that into a build error, and is worth adding the day the
 * application has enough client components for the risk to be real; today every
 * caller is a Server Component and the guard would be a dependency for one
 * import line.
 */

export type SprintMetrics = {
  readonly sprint: Sprint;
  readonly velocity: MetricResult<EstimateTotals>;
  readonly scopeChange: MetricResult<ScopeChange>;
  readonly carryOver: MetricResult<CarryOver>;
  readonly burndown: MetricResult<readonly BurndownPoint[]>;
  readonly flow: FlowSummary;
  /** Items that belonged to the sprint at its close. */
  readonly itemCount: number;
};

export type ProjectDashboard = {
  readonly project: Project;
  readonly sprints: readonly SprintMetrics[];
  /** The most recent sprint: the one a team actually asks about. */
  readonly current: SprintMetrics | null;
  readonly flow: FlowSummary;
  readonly wip: MetricResult<number>;
  /**
   * How the sprint that is still running is going.
   *
   * `null` when no sprint is open — deliberately distinct from an unavailable
   * result, because "there is no sprint to judge" and "there is one and I
   * cannot judge it" ask the page for two different screens.
   */
  readonly health: MetricResult<SprintHealth> | null;
  readonly peopleCount: number;
  readonly asOf: Date;
};

/**
 * Reads the project and everything needed to compute its metrics.
 *
 * `asOf` is a parameter rather than `new Date()` inside: the metrics engine
 * refuses to read the clock, and a caller that hides the instant here would
 * reintroduce exactly the irreproducibility that rule prevents.
 */
export async function loadProjectDashboard(
  organizationId: OrganizationId,
  slug: string,
  asOf: Date,
): Promise<ProjectDashboard | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  // Parsed rather than cast: the database returns rows, and trusting their
  // shape would defeat the point of having schemas (R4).
  const [sprintRows, itemRows, transitionRows, scopeRows, peopleRows] = await Promise.all([
    scope.reads.sprintsByProject(project.id),
    scope.reads.workItemsByProject(project.id),
    scope.reads.transitionsByProject(project.id),
    scope.reads.scopeEventsByProject(project.id),
    scope.reads.peopleByProject(project.id),
  ]);

  const sprints: Sprint[] = sprintRows.map((row) => sprintSchema.parse(row));
  const items: WorkItem[] = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions: StateTransition[] = transitionRows.map((row) =>
    stateTransitionSchema.parse(row),
  );
  const scopeEvents: SprintScopeEvent[] = scopeRows.map((row) =>
    sprintScopeEventSchema.parse(row),
  );

  const perSprint = sprints.map((sprint): SprintMetrics => {
    const sprintItems = items.filter((item) => item.sprintId === sprint.id);
    const sprintItemIds = new Set(sprintItems.map((item) => item.id));
    const sprintTransitions = transitions.filter((transition) =>
      sprintItemIds.has(transition.workItemId),
    );

    return {
      sprint,
      velocity: velocity(sprint, items, transitions, scopeEvents),
      scopeChange: scopeChange(sprint, items, scopeEvents),
      carryOver: carryOver(sprint, items, transitions, scopeEvents),
      burndown: burndown(sprint, items, transitions, scopeEvents, asOf),
      flow: summariseFlow(sprintItems, sprintTransitions, asOf),
      itemCount: sprintItems.length,
    };
  });

  /*
   * Lo sprint in corso, se ce n'è uno.
   *
   * «In corso» vuol dire non chiuso e con l'istante dentro le sue date, non
   * «l'ultimo dell'elenco»: l'ultimo sprint di un progetto fermo da mesi è
   * finito, e giudicarne la salute significherebbe rispondere a una domanda
   * che nessuno ha posto.
   */
  const running = sprints.find(
    (sprint) =>
      sprint.completedAt === null &&
      sprint.startsAt.getTime() <= asOf.getTime() &&
      sprint.endsAt.getTime() >= asOf.getTime(),
  );

  const columnRows = running ? await scope.reads.boardColumnsByProject(project.id) : [];

  return {
    project,
    sprints: perSprint,
    current: perSprint[perSprint.length - 1] ?? null,
    flow: summariseFlow(items, transitions, asOf),
    wip: workInProgress(transitions, asOf),
    health: running
      ? sprintHealth({
          sprint: running,
          items,
          transitions,
          scopeEvents,
          closedSprints: sprints.filter((sprint) => sprint.completedAt !== null),
          columns: columnRows.map((row) => boardColumnSchema.parse(row)),
          asOf,
        })
      : null,
    peopleCount: peopleRows.length,
    asOf,
  };
}

/** The projects an organization can open, for the index page. */
export async function loadProjects(organizationId: OrganizationId): Promise<readonly Project[]> {
  const scope = forOrganization(getDatabase(), organizationId);
  const rows = await scope.reads.projects();

  return rows.map((row) => projectSchema.parse(row));
}

/** Re-exported so the page can label board columns without reaching into the db. */
export const columnSchema = boardColumnSchema;
export const teamMemberSchema = personSchema;
