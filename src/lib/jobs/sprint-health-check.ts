import {
  boardColumnSchema,
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  stateTransitionSchema,
  workItemSchema,
  type HealthFinding,
  type HealthVerdict,
  type OrganizationId,
  type ProjectId,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { sprintHealth } from "@/metrics";

/**
 * The scheduled check of every running sprint.
 *
 * **What it adds is time, not arithmetic.** The calculation is the one the
 * dashboard already performs; the difference is that it happens without anybody
 * opening a page. That is the whole point: a sprint's health was only ever
 * computed when somebody looked, so the product had no way of knowing what it
 * said yesterday.
 *
 * **It calls no model and spends nothing.** A language model starting on its
 * own, at a cost, because a timer fired is exactly what a declared budget exists
 * to prevent. This job writes numbers, and numbers are free.
 *
 * Kept apart from the route that triggers it so it can be tested: a route
 * handler needs a framework and a request, and neither has anything to do with
 * deciding which sprints to look at.
 */

export type HealthCheckOutcome = {
  readonly projectId: ProjectId;
  readonly sprintId: string;
  readonly verdict: HealthVerdict;
};

export type HealthCheckSummary = {
  /** How many projects were examined. */
  readonly projectsExamined: number;
  /** How many judgements were written. */
  readonly checksRecorded: number;
  readonly outcomes: readonly HealthCheckOutcome[];
};

/** The UTC day of an instant, as `AAAA-MM-GG`: the key that makes a run idempotent. */
export function utcDay(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Runs the check for one organization's projects.
 *
 * Takes the organization rather than looping over all of them inside, because
 * the tenant scope is built per organization: building it here as well would
 * put the isolation rule in two places (§8.4).
 */
export async function checkOrganizationHealth(
  organizationId: OrganizationId,
  asOf: Date,
): Promise<HealthCheckSummary> {
  const scope = forOrganization(getDatabase(), organizationId);

  const projectRows = await scope.reads.projects();

  const outcomes: HealthCheckOutcome[] = [];
  let examined = 0;

  for (const projectRow of projectRows) {
    const project = projectSchema.parse(projectRow);
    examined += 1;

    const outcome = await checkProjectHealth(organizationId, project.id, asOf);
    if (outcome) outcomes.push(outcome);
  }

  return { projectsExamined: examined, checksRecorded: outcomes.length, outcomes };
}

/**
 * Il giudizio di **un** progetto, scritto nello storico.
 *
 * **Estratta dal ciclo perché ha un secondo chiamante**, e non è un dettaglio di
 * struttura: una lettura fatta a mano da «Leggi ora» cambia i dati esattamente
 * come una schedulata, quindi deve lasciare la stessa traccia. Senza, uno
 * storico si popolerebbe solo sulle installazioni che hanno acceso il job — e
 * chi legge un grafico vuoto non ha modo di sapere che il grafico funziona
 * benissimo e manca il timer.
 *
 * Restituisce `null` quando non c'è uno sprint in corso: non è un errore, è la
 * risposta a «cosa c'è da giudicare adesso».
 */
export async function checkProjectHealth(
  organizationId: OrganizationId,
  projectId: ProjectId,
  asOf: Date,
): Promise<HealthCheckOutcome | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const sprintRows = await scope.reads.sprintsByProject(projectId);
  const sprints = sprintRows.map((row) => sprintSchema.parse(row));

  /*
   * «In corso» significa non chiuso e con l'istante dentro le sue date, non
   * «l'ultimo dell'elenco»: l'ultimo sprint di un progetto fermo da mesi è
   * finito, e giudicarlo significherebbe rispondere a una domanda che nessuno
   * ha posto.
   */
  const running = sprints.find(
    (sprint) =>
      sprint.completedAt === null &&
      sprint.startsAt.getTime() <= asOf.getTime() &&
      sprint.endsAt.getTime() >= asOf.getTime(),
  );

  if (!running) return null;

  const [itemRows, transitionRows, scopeRows, columnRows] = await Promise.all([
    scope.reads.workItemsByProject(projectId),
    scope.reads.transitionsByProject(projectId),
    scope.reads.scopeEventsByProject(projectId),
    scope.reads.boardColumnsByProject(projectId),
  ]);

  const result = sprintHealth({
    sprint: running,
    items: itemRows.map((row) =>
      workItemSchema.parse({ ...row, estimate: workItemEstimate(row) }),
    ),
    transitions: transitionRows.map((row) => stateTransitionSchema.parse(row)),
    scopeEvents: scopeRows.map((row) => sprintScopeEventSchema.parse(row)),
    closedSprints: sprints.filter((sprint) => sprint.completedAt !== null),
    columns: columnRows.map((row) => boardColumnSchema.parse(row)),
    asOf,
  });

  /*
   * Anche un giudizio impossibile viene conservato.
   *
   * Omettere il giorno in cui la salute non era calcolabile lascerebbe nella
   * storia un buco indistinguibile da un giorno in cui il job non è partito.
   * «Non lo so» è un'informazione; l'assenza di una riga non lo è.
   */
  const verdict: HealthVerdict = result.available ? result.value.verdict : "not-evaluable";

  const findings: HealthFinding[] = result.available
    ? result.value.signals.map((signal) => ({
        id: signal.id,
        status: signal.status,
        metricId: signal.metricId,
        measured: signal.measured,
        threshold: signal.threshold,
        distance: signal.distance,
        missing: signal.missing,
      }))
    : [];

  /*
   * Una riga per sprint per giorno, aggiornata.
   *
   * La chiave è `(sprint, giorno UTC)`, quindi premere «Leggi ora» cinque volte
   * lascia un punto solo: quello dell'ultima valutazione, che è anche la più
   * informata. Uno storico con cinque punti sullo stesso giorno suggerirebbe una
   * variazione che non c'è stata.
   */
  await scope.writes.recordHealthCheck({
    projectId,
    sprintId: running.id,
    takenAt: asOf,
    takenOn: utcDay(asOf),
    verdict,
    elapsedFraction: result.available ? result.value.elapsedFraction : 0,
    findings,
  });

  return { projectId, sprintId: running.id, verdict };
}
