import {
  boardColumnSchema,
  boardSchema,
  projectSchema,
  stateTransitionSchema,
  type Board,
  type BoardColumn,
  type OrganizationId,
  type Project,
  type WorkItemState,
} from "@/domain";
import { forOrganization, getDatabase } from "@/db";
import { bottleneck, workItemsByState, type Bottleneck, type MetricResult } from "@/metrics";

/**
 * The board of a project: its columns, in order, and how full each one is.
 *
 * **Why this page had to exist.** `board_columns` has been in the database
 * since T1 and was the only entity of the canonical model that nothing ever
 * showed. That matters more than a gap in a table: the column is where a team
 * writes down the limit it set for itself, and a limit nobody can see is a
 * limit nobody checks. On the synthetic project two columns declare one, and
 * both are being exceeded — a fact the dashboard had no way of stating.
 *
 * The occupancy comes from `src/metrics` (R1). It is not a `count(*)` on
 * `work_items.state` for the reason ADR-0002 gives: the current state column
 * says where an item is now, and the figure this page shows is defined at an
 * instant, which only the history can answer.
 *
 * Server-side only, tenant-scoped through the shared helper (§8.4).
 */

export type ColumnOccupancy = {
  readonly column: BoardColumn;
  /**
   * Items in this column's state at the reference instant.
   *
   * `null` when several columns of the board share the same canonical state.
   * In that case the count is a fact about the state, not about either column,
   * and splitting it between them would be an invention: the history records
   * the state an item moved to, never the column it was dropped in.
   */
  readonly occupancy: number | null;
  /**
   * How the occupancy stands against the limit the team declared.
   *
   * `unknown` covers both "no limit declared" and "occupancy not attributable",
   * and the page says which — the two look the same on screen and are not the
   * same thing.
   */
  readonly standing: "within" | "at-limit" | "over" | "unknown";
};

export type ProjectFlow = {
  readonly project: Project;
  readonly board: Board | null;
  readonly columns: readonly ColumnOccupancy[];
  /**
   * The whole per-state count, kept so the page can report the states no
   * column covers. A team that has cancelled work and no "Annullato" column
   * would otherwise see those items vanish from the board with no explanation.
   */
  readonly byState: MetricResult<ReadonlyMap<WorkItemState, number>>;
  /**
   * Where the time goes between taking work on and finishing it.
   *
   * The columns say how full each phase is *now*; this says how much time work
   * spends in each. A full column and a slow one are different problems, and
   * only the second is a bottleneck.
   */
  readonly bottleneck: MetricResult<Bottleneck>;
  /**
   * Whether the agent may be asked to read the flow aloud.
   *
   * Read here so the button is offered only when pressing it would work: a
   * control that always refuses teaches a reader to ignore controls.
   */
  readonly narrationEnabled: boolean;
  readonly asOf: Date;
};

function standingOf(
  occupancy: number | null,
  wipLimit: number | null,
): ColumnOccupancy["standing"] {
  if (occupancy === null || wipLimit === null) return "unknown";
  if (occupancy > wipLimit) return "over";
  if (occupancy === wipLimit) return "at-limit";
  return "within";
}

export async function loadProjectFlow(
  organizationId: OrganizationId,
  slug: string,
  asOf: Date,
): Promise<ProjectFlow | null> {
  const scope = forOrganization(getDatabase(), organizationId);

  const [projectRow] = await scope.reads.projectBySlug(slug);
  if (!projectRow) return null;

  const project = projectSchema.parse(projectRow);

  const [boardRows, columnRows, transitionRows, agentRows] = await Promise.all([
    scope.reads.boardsByProject(project.id),
    scope.reads.boardColumnsByProject(project.id),
    scope.reads.transitionsByProject(project.id),
    scope.reads.scrumAgentByProject(project.id),
  ]);

  const columns = columnRows.map((row) => boardColumnSchema.parse(row));
  const transitions = transitionRows.map((row) => stateTransitionSchema.parse(row));

  const byState = workItemsByState(transitions, asOf);

  /*
   * Quante colonne rappresentano ciascuno stato.
   *
   * Serve prima di attribuire un conteggio: se due colonne dichiarano lo
   * stesso stato, il numero appartiene allo stato e non a una delle due.
   */
  const columnsPerState = new Map<WorkItemState, number>();
  for (const column of columns) {
    columnsPerState.set(column.state, (columnsPerState.get(column.state) ?? 0) + 1);
  }

  const occupancies = columns.map((column): ColumnOccupancy => {
    const shared = (columnsPerState.get(column.state) ?? 0) > 1;

    const occupancy =
      !byState.available || shared ? null : (byState.value.get(column.state) ?? 0);

    return {
      column,
      occupancy,
      standing: standingOf(occupancy, column.wipLimit),
    };
  });

  return {
    project,
    /*
     * Una sola bacheca, presa senza pretendere che ce ne sia una.
     *
     * Le fonti viste finora ne espongono una per progetto, e la pagina ne
     * mostra una. Una seconda sarebbe una domanda sui dati, non una ragione
     * per far fallire una lettura.
     */
    board: boardRows[0] ? boardSchema.parse(boardRows[0]) : null,
    columns: occupancies,
    byState,
    bottleneck: bottleneck(transitions, asOf),
    narrationEnabled: agentRows[0]?.enabledSkillKeys.includes("bottleneck-detection") ?? false,
    asOf,
  };
}
