import {
  projectSchema,
  sprintSchema,
  sprintScopeEventSchema,
  type OrganizationId,
  type Project,
  type Sprint,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { sprintItemCount, type MetricResult } from "@/metrics";

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
  const [sprintRows, scopeRows] = await Promise.all([
    scope.reads.sprintsByProject(project.id),
    scope.reads.scopeEventsByProject(project.id),
  ]);

  const sprints = sprintRows.map((row) => sprintSchema.parse(row));
  const scopeEvents = scopeRows.map((row) => sprintScopeEventSchema.parse(row));

  const rows = sprints.map(
    (sprint): SprintRow => ({
      sprint,
      status: statusOf(sprint, asOf),
      itemCount: sprintItemCount(sprint, scopeEvents, asOf),
    }),
  );

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
