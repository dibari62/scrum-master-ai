import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { CanonicalBatch, SourceIdentified } from "@/connectors/contract";
import type { OrganizationId, ProjectId } from "@/domain";

import type { Database } from "./client";
import { toEstimateChangeRow, toWorkItemRow } from "./rows";
import {
  boardColumns,
  boards,
  comments,
  estimateChanges,
  impediments,
  people,
  pullRequests,
  sprintScopeEvents,
  sprints,
  stateTransitions,
  workItems,
} from "./schema";

/**
 * Writing a connector's batch into the database, repeatably.
 *
 * The half that was missing between `src/connectors` and the portal: a
 * connector produces canonical records, and until now only `scripts/seed.ts`
 * knew how to store them — by emptying the project first. That works exactly
 * once. A project reading from Jira is read again tomorrow, and the second read
 * overlaps the first.
 *
 * **Reconciliation, not insertion.** Every canonical table carries a unique
 * `(project_id, source_system, source_id)`, so a record already seen is
 * recognised and updated rather than duplicated. The contract already requires
 * a connector to produce the same identifiers for the same source records; this
 * module is what turns that promise into a property of the database.
 *
 * The consequence worth stating: running a synchronisation twice leaves the
 * same rows. An interrupted one can simply be repeated.
 */

/** What a synchronisation did, per entity, so it can be reported rather than assumed. */
export type IngestReport = {
  readonly counts: Readonly<Record<string, number>>;
  /** Every row written, across all entities. */
  readonly total: number;
};

export class ForeignOrganizationError extends Error {
  constructor(
    readonly expected: OrganizationId,
    readonly found: string,
    readonly entity: string,
  ) {
    super(
      `il lotto contiene un record dell'organizzazione ${found} in una sincronizzazione di ${expected} (${entity})`,
    );
    this.name = "ForeignOrganizationError";
  }
}

export class ForeignProjectError extends Error {
  constructor(
    readonly expected: ProjectId,
    readonly found: string,
    readonly entity: string,
  ) {
    super(
      `il lotto contiene un record del progetto ${found} in una sincronizzazione di ${expected} (${entity})`,
    );
    this.name = "ForeignProjectError";
  }
}

type Scoped = SourceIdentified & {
  readonly organizationId: string;
  readonly projectId: string;
};

/**
 * Refuses a batch that names an organization or a project other than the one
 * being synchronised.
 *
 * **Refuses rather than rewrites**, and the difference matters. Overwriting the
 * keys would make every batch fit, including one produced by a connector
 * pointed at the wrong Jira project — and the rows would land looking perfectly
 * ordinary. §8.4 is about a tenant never seeing another's data; silently
 * relabelling data is how it would get there.
 *
 * The check is cheap and total: it runs over every record, not a sample.
 */
function assertBelongs(
  records: readonly Scoped[],
  entity: string,
  organizationId: OrganizationId,
  projectId: ProjectId,
): void {
  for (const record of records) {
    if (record.organizationId !== organizationId) {
      throw new ForeignOrganizationError(organizationId, record.organizationId, entity);
    }
    if (record.projectId !== projectId) {
      throw new ForeignProjectError(projectId, record.projectId, entity);
    }
  }
}

/**
 * The `set` clause of an upsert: every column except the ones that must not move.
 *
 * `id` is excluded because other tables point at it. A state transition
 * references a work item by primary key, and an ingestion that reassigned that
 * key would leave the reference dangling — or, worse, pointing at the wrong
 * item. `createdAt` is excluded because it records when *we* first saw the
 * record, which a later sighting does not change.
 *
 * Built from the table's own columns rather than listed by hand: fifteen
 * hand-written lists would drift the first time a column is added, and the
 * column that went missing would be the one nobody thought to update.
 */
function updateAllColumns(table: PgTable): Record<string, SQL> {
  const set: Record<string, SQL> = {};

  for (const [property, column] of Object.entries(getTableColumns(table))) {
    if (property === "id" || property === "createdAt") continue;
    set[property] = sql.raw(`excluded."${column.name}"`);
  }

  return set;
}

export type IngestOptions = {
  readonly organizationId: OrganizationId;
  readonly projectId: ProjectId;
  readonly batch: CanonicalBatch;
  readonly db: Database;
};

/**
 * Writes a batch, updating what was already there.
 *
 * **Order is a constraint, not a preference.** A row cannot reference something
 * that does not exist yet: people and sprints precede work items, and work
 * items precede their history. The same order as `scripts/seed.ts`, for the
 * same reason.
 *
 * **Not wrapped in one transaction, and that is a decision.** The Neon HTTP
 * driver used in production does not offer interactive transactions, and a
 * partial synchronisation is recoverable in a way a partial *insert* would not
 * be: every statement here is an upsert, so repeating the run finishes the job.
 * Idempotence is doing the work that atomicity would have done.
 */
export async function ingestBatch(options: IngestOptions): Promise<IngestReport> {
  const { organizationId, projectId, batch, db } = options;

  const counts: Record<string, number> = {};
  let total = 0;

  /*
   * Each write is its own statement rather than a loop over a heterogeneous
   * list, for the reason `scripts/seed.ts` already gives: the loop only
   * compiles with a cast that disables the checking worth having.
   *
   * The connector returns `readonly` arrays deliberately. Drizzle wants mutable
   * ones, so each is copied here rather than weakening the connector's type to
   * suit its writer.
   */
  const steps: readonly (readonly [string, readonly Scoped[], () => Promise<unknown>])[] = [
    [
      "persone",
      batch.people,
      () =>
        db
          .insert(people)
          .values([...batch.people])
          .onConflictDoUpdate({
            target: [people.projectId, people.sourceSystem, people.sourceId],
            set: updateAllColumns(people),
          }),
    ],
    [
      "board",
      batch.boards,
      () =>
        db
          .insert(boards)
          .values([...batch.boards])
          .onConflictDoUpdate({
            target: [boards.projectId, boards.sourceSystem, boards.sourceId],
            set: updateAllColumns(boards),
          }),
    ],
    [
      "colonne",
      batch.boardColumns,
      () =>
        db
          .insert(boardColumns)
          .values([...batch.boardColumns])
          .onConflictDoUpdate({
            target: [boardColumns.projectId, boardColumns.sourceSystem, boardColumns.sourceId],
            set: updateAllColumns(boardColumns),
          }),
    ],
    [
      "sprint",
      batch.sprints,
      () =>
        db
          .insert(sprints)
          .values([...batch.sprints])
          .onConflictDoUpdate({
            target: [sprints.projectId, sprints.sourceSystem, sprints.sourceId],
            set: updateAllColumns(sprints),
          }),
    ],
    [
      "elementi di lavoro",
      batch.workItems,
      () =>
        db
          .insert(workItems)
          .values(batch.workItems.map(toWorkItemRow))
          .onConflictDoUpdate({
            target: [workItems.projectId, workItems.sourceSystem, workItems.sourceId],
            set: updateAllColumns(workItems),
          }),
    ],
    [
      "transizioni",
      batch.transitions,
      () =>
        db
          .insert(stateTransitions)
          .values([...batch.transitions])
          .onConflictDoUpdate({
            target: [
              stateTransitions.projectId,
              stateTransitions.sourceSystem,
              stateTransitions.sourceId,
            ],
            set: updateAllColumns(stateTransitions),
          }),
    ],
    [
      "variazioni di stima",
      batch.estimateChanges,
      () =>
        db
          .insert(estimateChanges)
          .values(batch.estimateChanges.map(toEstimateChangeRow))
          .onConflictDoUpdate({
            target: [
              estimateChanges.projectId,
              estimateChanges.sourceSystem,
              estimateChanges.sourceId,
            ],
            set: updateAllColumns(estimateChanges),
          }),
    ],
    [
      "variazioni di perimetro",
      batch.scopeEvents,
      () =>
        db
          .insert(sprintScopeEvents)
          .values([...batch.scopeEvents])
          .onConflictDoUpdate({
            target: [
              sprintScopeEvents.projectId,
              sprintScopeEvents.sourceSystem,
              sprintScopeEvents.sourceId,
            ],
            set: updateAllColumns(sprintScopeEvents),
          }),
    ],
    [
      "commenti",
      batch.comments,
      () =>
        db
          .insert(comments)
          .values([...batch.comments])
          .onConflictDoUpdate({
            target: [comments.projectId, comments.sourceSystem, comments.sourceId],
            set: updateAllColumns(comments),
          }),
    ],
    [
      "impedimenti",
      batch.impediments,
      () =>
        db
          .insert(impediments)
          .values([...batch.impediments])
          .onConflictDoUpdate({
            target: [impediments.projectId, impediments.sourceSystem, impediments.sourceId],
            set: updateAllColumns(impediments),
          }),
    ],
    [
      "pull request",
      batch.pullRequests,
      () =>
        db
          .insert(pullRequests)
          .values([...batch.pullRequests])
          .onConflictDoUpdate({
            target: [pullRequests.projectId, pullRequests.sourceSystem, pullRequests.sourceId],
            set: updateAllColumns(pullRequests),
          }),
    ],
  ];

  /*
   * Ogni record è verificato **prima** che qualsiasi statement parta.
   *
   * Un lotto misto verrebbe altrimenti scritto a metà: le persone di un'altra
   * organizzazione sarebbero già dentro quando il controllo fallisce sugli
   * elementi di lavoro. Qui il rifiuto è totale o non c'è.
   */
  for (const [entity, records] of steps) {
    assertBelongs(records, entity, organizationId, projectId);
  }

  for (const [entity, records, run] of steps) {
    counts[entity] = records.length;
    if (records.length === 0) continue;

    await run();
    total += records.length;
  }

  return { counts, total };
}

/**
 * What a batch carries that this module deliberately does not write.
 *
 * Forecasts, retrospectives and their notes are things a team **writes down**,
 * not things a board can be asked for. No connector reading a real tool
 * produces them today, and the tables that hold them have no
 * `(source_system, source_id)` to reconcile on — they are authored inside the
 * portal, and an ingestion that overwrote them would destroy the only records
 * here that a person typed.
 *
 * Listed rather than left out silently: a reader wondering "and the
 * retrospectives?" deserves the answer in the same file.
 */
export const NOT_INGESTED = [
  "sprintStatistics",
  "retrospectives",
  "retrospectiveNotes",
  "improvementActions",
] as const;
