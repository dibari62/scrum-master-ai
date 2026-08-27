import {
  acceptanceThresholdsSchema,
  definitionOfReadySchema,
  productBacklog,
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type AcceptanceThresholdCutoffs,
  type OrganizationId,
  type Project,
  type WorkItem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { toEstimateChange, workItemEstimate } from "@/db/rows";
import {
  acceptanceCoverage,
  MIN_STORIES_PER_SPRINT,
  readinessCheck,
  releasePlan,
  totalEstimates,
  yesterdaysWeather,
  type AcceptanceCoverage,
  type EstimateTotals,
  type ReadinessCheck,
  type ReleasePlan,
} from "@/metrics";

/**
 * The product backlog: what is not yet in a sprint, in the order it will be
 * taken.
 *
 * A screen of its own rather than a filter on the items list, because the two
 * answer different questions. The items list answers "what is going on"; this
 * answers **"what comes next"**, and the answer is the *order* — which a list
 * sorted by cycle time cannot show.
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

export type BacklogList = {
  readonly project: Project;
  readonly items: readonly WorkItem[];

  /**
   * How much work the backlog holds, split by estimate unit.
   *
   * Split and never one number: a team estimating in points and one estimating
   * in hours produce figures that must not be summed (`EstimateTotals`).
   */
  readonly total: EstimateTotals;

  /** Items with no position yet: the ones nobody has placed. */
  readonly unplacedCount: number;

  /** Items that say how they will be demonstrated. */
  readonly describedCount: number;

  /** Where the Product Owner cut the list, or `null` if nobody has. */
  readonly thresholds: AcceptanceThresholdCutoffs | null;

  /** How much work each acceptance band holds. */
  readonly coverage: AcceptanceCoverage;

  /**
   * The backlog cut into sprints, at the velocity the project last delivered.
   *
   * `null` when there is nothing to cut it with. The velocity is **observed**,
   * never asked for: the book's own advice is «yesterday's weather», and a
   * number typed into a form would be a forecast dressed as a measurement.
   */
  readonly plan: ReleasePlan | null;

  /**
   * Where the velocity used for the plan came from.
   *
   * Shown beside the plan, because a projection is only as good as the figure
   * under it and a reader must be able to check that figure rather than trust
   * it.
   */
  readonly velocitySource: string | null;

  /** Whether this reader may change the thresholds. */
  readonly canConfigure: boolean;

  /**
   * How much of the top of the backlog is ready to be pulled into a sprint.
   *
   * Only the top, because the book is explicit: the check is for the stories
   * «that ha[ve] high enough importance to be considered for this sprint».
   * Running it over a whole backlog would report a hundred unready stories
   * nobody was going to start, and an alert nobody can act on is one people
   * learn to skip.
   */
  readonly readiness: ReadinessCheck;

  /** What the team itself requires before pulling a story in. */
  readonly definitionOfReady: readonly string[];
};

export async function loadBacklog(
  organizationId: OrganizationId,
  slug: string,
  canConfigure: boolean,
  asOf: Date,
): Promise<BacklogList | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [itemRows, contextRows, sprintRows, transitionRows, scopeRows, estimateRows] =
    await Promise.all([
      scope.reads.workItemsByProject(project.id),
      scope.reads.projectContextByProject(project.id),
      scope.reads.sprintsByProject(project.id),
      scope.reads.transitionsByProject(project.id),
      scope.reads.scopeEventsByProject(project.id),
      scope.reads.estimateChangesByProject(project.id),
    ]);

  const all = itemRows.map((row) =>
    workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
  );

  /*
   * L'ordine è una regola del dominio, non di questa pagina.
   *
   * Due schermate che ordinassero il backlog per conto proprio finirebbero per
   * non concordare, e il giorno in cui il piano di rilascio taglierà questa
   * lista in sprint dovrà vederla nello stesso ordine in cui la si legge qui.
   */
  const items = productBacklog(all);

  /*
   * Le soglie si convalidano, non si assumono.
   *
   * La colonna è `jsonb` e il tipo che le abbiamo attribuito è una nostra
   * dichiarazione, non una verifica del database: una forma che questa
   * versione non conosce deve essere visibile, non propagata in una pagina che
   * dichiara impegni contrattuali.
   */
  const thresholds = contextRows[0]
    ? acceptanceThresholdsSchema.parse(contextRows[0].acceptanceThresholds ?? null)
    : null;

  /*
   * La velocity del piano si **osserva**, non si chiede.
   *
   * È il «meteo di ieri» del libro: la media dei punti chiusi negli sprint
   * conclusi. Un numero digitato in un modulo sarebbe una previsione travestita
   * da misura, e il piano che ne uscisse racconterebbe la speranza di chi lo ha
   * scritto invece della storia della squadra.
   *
   * Quando non è calcolabile — nessuno sprint chiuso, oppure unità di stima
   * miste — non si ripiega su un valore inventato: non c'è piano, e la pagina
   * lo dice.
   */
  const sprints = sprintRows.map((row) => sprintSchema.parse(row));
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));
  const scopeEvents = scopeRows.map((row) => sprintScopeEventSchema.parse(row));
  const estimateChanges = estimateRows.map((row) => toEstimateChange(row));

  const observed = yesterdaysWeather(
    sprints,
    all,
    transitions,
    scopeEvents,
    asOf,
    estimateChanges,
  );

  return {
    project,
    items,
    total: totalEstimates(items),
    unplacedCount: items.filter((item) => item.backlogOrder === null).length,
    describedCount: items.filter((item) => item.howToDemo !== null).length,
    thresholds,
    coverage: acceptanceCoverage(items, thresholds),
    plan: observed.available ? releasePlan(items, observed.value) : null,
    velocitySource: observed.available
      ? `media dei punti conclusi negli ultimi ${formatCount(observed.sampleSize)} sprint chiusi`
      : null,
    /*
     * Quanto in profondità guardare: uno sprint di lavoro.
     *
     * «for each story that has high enough importance to be considered for this
     * sprint». La velocity osservata dice quante storie sono uno sprint, ma
     * conta i **punti**, non gli elementi — e la profondità è in elementi.
     * Il piano di rilascio ha già fatto quel taglio: il primo sprint del piano
     * è esattamente «ciò che verrebbe preso», ed è il numero giusto.
     *
     * Senza piano si ripiega sul minimo del libro, 5 storie per sprint
     * (pag. 43), invece di guardare tutto: è un numero dichiarato, non uno
     * inventato.
     */
    readiness: readinessCheck(
      items,
      observed.available
        ? (releasePlan(items, observed.value).sprints[0]?.items.length ?? MIN_STORIES_PER_SPRINT)
        : MIN_STORIES_PER_SPRINT,
    ),
    definitionOfReady: contextRows[0]
      ? definitionOfReadySchema.parse(contextRows[0].definitionOfReady ?? [])
      : [],
    canConfigure,
  };
}

/** Italian needs the singular for one, and «1 sprint chiusi» reads as generated. */
function formatCount(count: number): string {
  return count === 1 ? "1" : String(count);
}
