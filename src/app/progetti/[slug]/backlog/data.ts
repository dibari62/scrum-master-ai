import {
  productBacklog,
  projectSchema,
  workItemSchema,
  type OrganizationId,
  type Project,
  type WorkItem,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { workItemEstimate } from "@/db/rows";
import { totalEstimates, type EstimateTotals } from "@/metrics";

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
};

export async function loadBacklog(
  organizationId: OrganizationId,
  slug: string,
): Promise<BacklogList | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const itemRows = await scope.reads.workItemsByProject(project.id);
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

  return {
    project,
    items,
    total: totalEstimates(items),
    unplacedCount: items.filter((item) => item.backlogOrder === null).length,
    describedCount: items.filter((item) => item.howToDemo !== null).length,
  };
}
