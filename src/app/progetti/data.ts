import {
  boardColumnSchema,
  healthVerdictSchema,
  personSchema,
  projectSchema,
  workingCalendarSchema,
  DEFAULT_WORKING_CALENDAR,
  sprintSchema,
  sprintScopeEventSchema,
  sprintStatisticsSchema,
  stateTransitionSchema,
  workItemSchema,
  type HealthVerdict,
  type EstimateChange,
  type OrganizationId,
  type Project,
  type Sprint,
  type SprintScopeEvent,
  type SprintStatistics,
  type StateTransition,
  type WorkItem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { toEstimateChange, workItemEstimate } from "@/db/rows";
import {
  burndown,
  carryOver,
  forecastVariance,
  scopeChange,
  sprintHealth,
  summariseFlow,
  velocity,
  workInProgress,
  type Burndown,
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
  readonly burndown: MetricResult<Burndown>;
  readonly flow: FlowSummary;
  /** Items that belonged to the sprint at its close. */
  readonly itemCount: number;

  /**
   * The forecast recorded when the sprint began.
   *
   * `null` when nobody recorded one, and that stays `null`: computing a
   * forecast now for a sprint that closed weeks ago would be inventing a plan
   * the team never made. The interface says «nessuna previsione registrata»,
   * which is true and useful, rather than showing a number nobody promised.
   */
  readonly forecast: SprintStatistics | null;

  /**
   * Delivered minus forecast, in points. `null` without a forecast.
   *
   * Derived rather than stored, because both sides of the subtraction are
   * available and a stored copy could drift from them.
   */
  readonly forecastVariance: MetricResult<number> | null;

  /**
   * I punti chiave della retrospettiva di questo sprint.
   *
   * La checklist del capitolo 16 chiede di aggiornare le statistiche con «the
   * actual velocity **and key points from the retrospective**» (pag. 163). Nel
   * libro sono su un wiki e si ricopiano a mano; qui le due entità esistono già
   * entrambe, quindi si **collegano** invece di duplicarle — una copia dei punti
   * chiave accanto alle note originali divergerebbe alla prima correzione (R4).
   *
   * Vuoto quando la retrospettiva non è stata tenuta, o non ha lasciato note.
   */
  readonly retrospectiveKeyPoints: readonly string[];
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
  /**
   * The kept judgements on the running sprint, oldest first.
   *
   * Written by the scheduled check, never by this page. It is the only thing
   * here that the on-demand calculation cannot produce: the health is worked
   * out when somebody looks, so without these rows yesterday's verdict was
   * never computed at all.
   */
  readonly healthHistory: readonly HealthCheckPoint[];
  /**
   * Whether the agent can be asked to explain the verdict.
   *
   * Read here rather than in the page so the button is offered only when
   * pressing it would work. A control that always refuses teaches a reader to
   * ignore controls.
   */
  readonly healthNarrationEnabled: boolean;
  /** Whether the agent may be asked to write up the previous day. */
  readonly digestEnabled: boolean;
  readonly peopleCount: number;
  readonly asOf: Date;
};

/** One kept judgement, reduced to what a trend needs. */
export type HealthCheckPoint = {
  readonly takenAt: Date;
  readonly verdict: HealthVerdict;
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
  const [
    sprintRows,
    itemRows,
    transitionRows,
    estimateRows,
    scopeRows,
    statisticsRows,
    peopleRows,
    agentRows,
    contextRows,
    retroRows,
    retroNoteRows,
  ] = await Promise.all([
    scope.reads.sprintsByProject(project.id),
    scope.reads.workItemsByProject(project.id),
    scope.reads.transitionsByProject(project.id),
    scope.reads.estimateChangesByProject(project.id),
    scope.reads.scopeEventsByProject(project.id),
    scope.reads.sprintStatisticsByProject(project.id),
    scope.reads.peopleByProject(project.id),
    scope.reads.scrumAgentByProject(project.id),
    scope.reads.projectContextByProject(project.id),
    scope.reads.retrospectivesByProject(project.id),
    scope.reads.retrospectiveNotesByProject(project.id),
  ]);

  /*
   * I punti chiave della retrospettiva, per sprint.
   *
   * La checklist del capitolo 16 chiede di aggiornare le statistiche con «the
   * actual velocity **and key points from the retrospective**». Le due entità
   * esistono già entrambe: si collegano, non si duplicano.
   */
  const keyPointsBySprint = new Map<string, string[]>();

  for (const retro of retroRows) {
    const notes = retroNoteRows
      .filter((note) => note.retrospectiveId === retro.id)
      .map((note) => note.text);

    if (notes.length > 0) keyPointsBySprint.set(retro.sprintId, notes);
  }

  /*
   * Il calendario della squadra, non quello predefinito.
   *
   * Senza, il burndown saltava sempre e solo i fine settimana: per una squadra
   * italiana Ferragosto e Pasquetta venivano disegnati come giornate di lavoro
   * fermo, cioè l'allarme fabbricato che il libro descrive a pag. 62.
   */
  const calendar = contextRows[0]
    ? workingCalendarSchema.parse(contextRows[0].workingCalendar)
    : DEFAULT_WORKING_CALENDAR;

  const sprints: Sprint[] = sprintRows.map((row) => sprintSchema.parse(row));
  const items: WorkItem[] = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );
  const transitions: StateTransition[] = transitionRows.map((row) =>
    stateTransitionSchema.parse(row),
  );
  const estimateChanges: EstimateChange[] = estimateRows.map((row) => toEstimateChange(row));
  const scopeEvents: SprintScopeEvent[] = scopeRows.map((row) =>
    sprintScopeEventSchema.parse(row),
  );

  const forecastBySprint = new Map(
    statisticsRows
      .map((row) => sprintStatisticsSchema.parse(row))
      .map((entry) => [entry.sprintId, entry]),
  );

  const perSprint = sprints.map((sprint): SprintMetrics => {
    const sprintItems = items.filter((item) => item.sprintId === sprint.id);
    const sprintItemIds = new Set(sprintItems.map((item) => item.id));
    const sprintTransitions = transitions.filter((transition) =>
      sprintItemIds.has(transition.workItemId),
    );

    const forecast = forecastBySprint.get(sprint.id) ?? null;

    return {
      sprint,
      velocity: velocity(sprint, items, transitions, scopeEvents, estimateChanges),
      scopeChange: scopeChange(sprint, items, scopeEvents, estimateChanges),
      carryOver: carryOver(sprint, items, transitions, scopeEvents, estimateChanges),
      burndown: burndown(sprint, items, transitions, scopeEvents, asOf, {
        estimateChanges,
        calendar,
      }),
      flow: summariseFlow(sprintItems, sprintTransitions, asOf),
      itemCount: sprintItems.length,
      forecast,
      forecastVariance: forecast
        ? forecastVariance(
            sprint,
            items,
            transitions,
            scopeEvents,
            forecast.forecastPoints,
            estimateChanges,
          )
        : null,
      retrospectiveKeyPoints: keyPointsBySprint.get(sprint.id) ?? [],
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

  /*
   * La storia dei giudizi, solo per lo sprint in corso.
   *
   * Chiederla anche quando nessuno sprint è aperto sarebbe un viaggio al
   * database per una domanda che la pagina non porrà.
   */
  const historyRows = running ? await scope.reads.healthChecksBySprint(running.id) : [];

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
    healthHistory: historyRows.map((row) => ({
      takenAt: row.takenAt,
      verdict: healthVerdictSchema.parse(row.verdict),
    })),
    healthNarrationEnabled: agentRows[0]?.enabledSkillKeys.includes("sprint-health") ?? false,
    digestEnabled: agentRows[0]?.enabledSkillKeys.includes("daily-digest") ?? false,
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
