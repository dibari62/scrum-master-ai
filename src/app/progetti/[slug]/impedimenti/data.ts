import {
  impedimentSchema,
  isImpedimentOpen,
  projectSchema,
  workItemSchema,
  type Impediment,
  type OrganizationId,
  type Project,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";

/**
 * The impediments of a project: what slowed the team down, and for how long.
 *
 * **Why an impediment is not a blocked item.** The two are easy to conflate and
 * the model keeps them apart on purpose: an impediment can outlive the item
 * that revealed it, and can hold up several at once. "The payment provider is
 * not answering" is one impediment; the four items waiting on it are four
 * items. Counting the items would report the same obstacle four times, and
 * counting only the obstacle would hide how much work it touched.
 *
 * The table has been in the database since T1 with nothing reading it. It is
 * the register a retrospective actually needs — and the first thing a
 * bottleneck skill will have to explain (T5).
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

export type ImpedimentEntry = {
  readonly impediment: Impediment;
  readonly open: boolean;
  /**
   * How long it stood, in milliseconds: to resolution, or to now if still open.
   *
   * Plain arithmetic on two instants rather than a metric, and deliberately so:
   * `src/metrics` holds the figures that have a contested definition and need
   * edge cases. "End minus start" has neither.
   */
  readonly durationMs: number;
  /** Title of the item that revealed it, when it is still in the project. */
  readonly workItemTitle: string | null;
};

export type ProjectImpediments = {
  readonly project: Project;
  readonly entries: readonly ImpedimentEntry[];
  readonly openCount: number;
  readonly asOf: Date;
};

export async function loadProjectImpediments(
  organizationId: OrganizationId,
  slug: string,
  asOf: Date,
): Promise<ProjectImpediments | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [impedimentRows, itemRows] = await Promise.all([
    scope.reads.impedimentsByProject(project.id),
    scope.reads.workItemsByProject(project.id),
  ]);

  /*
   * I titoli degli elementi, non gli elementi.
   *
   * L'impedimento cita l'elemento che lo ha fatto emergere, e mostrare un
   * identificativo al posto di un titolo obbliga chi legge ad andarlo a
   * cercare altrove.
   */
  const titles = new Map(
    itemRows.map((row) => {
      // `estimate` è nidificato nel modello canonico e piatto in tabella: la
      // ricomposizione ha un helper condiviso, e rifarla a mano qui era il
      // difetto che questa pagina ha mostrato alla prima apertura.
      const item = workItemSchema.parse({ ...row, estimate: workItemEstimate(row) });
      return [item.id, item.title] as const;
    }),
  );

  const entries = impedimentRows.map((row): ImpedimentEntry => {
    const impediment = impedimentSchema.parse(row);
    const open = isImpedimentOpen(impediment);

    const end = impediment.resolvedAt ?? asOf;

    return {
      impediment,
      open,
      // Mai negativa: una fonte che registra la risoluzione prima
      // dell'apertura è un difetto, e mostrare «-3 giorni» lo trasforma in un
      // difetto di questa pagina agli occhi di chi legge.
      durationMs: Math.max(0, end.getTime() - impediment.raisedAt.getTime()),
      workItemTitle:
        impediment.workItemId === null
          ? null
          : (titles.get(impediment.workItemId) ?? null),
    };
  });

  return {
    project,
    entries,
    openCount: entries.filter((entry) => entry.open).length,
    asOf,
  };
}
